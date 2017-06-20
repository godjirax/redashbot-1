"use strict";

const Botkit = require("botkit");
const webshot = require("webshot");
const tempfile = require("tempfile");
const fs = require("fs");
const request = require("request");
var env = require('node-env-file');
var screenshotSelector = require('./screenshotSelector');
var Nightmare = require('nightmare');
var _ = require('lodash');

var graphs = {};

env(__dirname + '/../.env');

// This configuration can gets overwritten when process.env.SLACK_MESSAGE_EVENTS is given.
const DEFAULT_SLACK_MESSAGE_EVENTS = "direct_message,direct_mention,mention";

if (!process.env.SLACK_BOT_TOKEN) {
  console.error("Error: Specify SLACK_BOT_TOKEN in environment values");
  process.exit(1);
}
if (!((process.env.REDASH_HOST && process.env.REDASH_API_KEY) || (process.env.REDASH_HOSTS_AND_API_KEYS))) {
  console.error("Error: Specify REDASH_HOST and REDASH_API_KEY in environment values");
  console.error("Or you can set multiple Re:dash configs by specifying like below");
  console.error("REDASH_HOSTS_AND_API_KEYS=\"http://redash1.example.com;TOKEN1,http://redash2.example.com;TOKEN2\"");
  process.exit(1);
}

const parseApiKeysPerHost = () => {
  if (process.env.REDASH_HOST) {
    if (process.env.REDASH_HOST_ALIAS) {
      return {[process.env.REDASH_HOST]: {"alias": process.env.REDASH_HOST_ALIAS, "key": process.env.REDASH_API_KEY}};
    } else {
      return {[process.env.REDASH_HOST]: {"alias": process.env.REDASH_HOST, "key": process.env.REDASH_API_KEY}};
    }
  } else {
    return process.env.REDASH_HOSTS_AND_API_KEYS.split(",").reduce((m, host_and_key) => {
      var [host, alias, key] = host_and_key.split(";");
      if (!key) {
        key = alias;
        alias = host;
      }
      m[host] = {"alias": alias, "key": key};
      return m;
    }, {});
  }
};

const redashApiKeysPerHost = parseApiKeysPerHost();
const slackBotToken = process.env.SLACK_BOT_TOKEN;
const slackMessageEvents = process.env.SLACK_MESSAGE_EVENTS || DEFAULT_SLACK_MESSAGE_EVENTS;

const controller = Botkit.slackbot({
  debug: !!process.env.DEBUG
});

controller.spawn({
  token: slackBotToken
}).startRTM();

Object.keys(redashApiKeysPerHost).forEach((redashHost) => {
  const redashHostAlias = redashApiKeysPerHost[redashHost]["alias"];
  const redashApiKey    = redashApiKeysPerHost[redashHost]["key"];

  // Update available charts.
  updateAvailableCharts(redashHostAlias, redashApiKey);

  // Listen "update": update available charts.
  controller.hears('update',['direct_message','direct_mention','mention'],function(bot,message) {
    bot.reply(message,'Updating charts...');

    updateAvailableCharts(redashHostAlias, redashApiKey, function(err,msg) {
      bot.reply(message,msg);
    })
  });

  // Listen "list": list all available charts.
  controller.hears('list',['direct_message','direct_mention','mention'],function(bot,message) {
      var msg = "You can choose between:\n";
      var key;

      for ( key in graphs ) {
         msg += "- "+key+"\n";
      }

      msg += '\nSay me "show" + chart name. e.g: "show '+key+'"';
      bot.reply(message, msg);
  });

  // Listen "show" + chart name: display chart by name.
  controller.hears(`show ([-_ a-zA-Z0-9]+)`, slackMessageEvents, (bot, message) => {
    const queryName = _.trim(message.match[1]);

    getVisualizationIdByChartName(redashHostAlias, redashApiKey, queryName, (err, visualisation) => {
      if ( err ) {
        bot.reply(message, err);
      } else {
        showGraph(redashHostAlias, redashApiKey, redashHost, bot, message, graphs[queryName], visualisation);
      }
    });
  });

  // Listen for url like: http://${redashHost}/queries/${redashHost}#${visualizationId}
  controller.hears(`${redashHost}/queries/([0-9]+)#([0-9]+)`, slackMessageEvents, (bot, message) => {
    const queryId = message.match[1];
    const visualizationId =  message.match[2];
    showGraph(redashHostAlias, redashApiKey, redashHost, bot, message, queryId, visualizationId);
  });
});

/**
 * Show chart by query id. Look for first chart vidualisation for query id.
 * @param  {[type]} redashHostAlias
 * @param  {[type]} redashApiKey
 * @param  {[type]} bot
 * @param  {[type]} message
 * @param  {[type]} queryId
 * @param  {[type]} visualizationId
 */
function showGraph(redashHostAlias, redashApiKey, redashHost, bot, message, queryId, visualizationId) {
  const embedUrl = `${redashHostAlias}/embed/query/${queryId}/visualization/${visualizationId}?api_key=${redashApiKey}`;

  bot.reply(message, `Taking screenshot...`);
  bot.botkit.log(embedUrl);

  const outputFile = tempfile(".png");

  new Nightmare()
    .goto(embedUrl)
    .wait('.modebar-btn, .ng-isolate-scope')
    .use(screenshotSelector(outputFile, '.tile.m-10', function(){
     console.log("Screenshot Saved to "+ outputFile)

     bot.botkit.log.debug(outputFile);
     bot.botkit.log.debug(Object.keys(message));
     bot.botkit.log(message.user + ":" + message.type + ":" + message.channel + ":" + message.text);

     const options = {
       token: slackBotToken,
       filename: `query-${queryId}-visualization-${visualizationId}.png`,
       file: fs.createReadStream(outputFile),
       channels: message.channel
     };

     // bot.api.file.upload cannot upload binary file correctly, so directly call Slack API.
     request.post({ url: "https://api.slack.com/api/files.upload", formData: options }, (err, resp, body) => {
       if (err) {
         const msg = `Something wrong happend in file upload : ${err}`;
         bot.reply(message, msg);
         bot.botkit.log.error(msg);
       } else if (resp.statusCode == 200) {
         bot.botkit.log("ok");
       } else {
         const msg = `Something wrong happend in file upload : status code=${resp.statusCode}`;
         bot.reply(message, msg);
         bot.botkit.log.error(msg);
       }
     });
   }))
}

/**
 * Return visualisation id with type 'CHART' for query name.
 * @param  {[type]}   redashHostAlias
 * @param  {[type]}   redashApiKey
 * @param  {[type]}   name
 * @param  {Function} cb             Call back function called when finish.
 */
function getVisualizationIdByChartName(redashHostAlias, redashApiKey, name, cb) {
  var id = graphs[name];

  if (!id) {
    cb(`No graph with name ${name}`)
  }  else {
    const queryUrl = `${redashHostAlias}/api/queries/${id}?api_key=${redashApiKey}`;

    request.get(queryUrl, (err, resp, body) => {
      var query = JSON.parse(body);

      if ( !query ) {
        if ( cb ) {
          cb(`No query for id ${id}`)
        }
      } else if (!query.visualizations) {
        if ( cb ) {
          cb(`No visualisations for graph id ${id}`)
        }
      } else {
        var vis = _.find(query.visualizations, function(o) {
          return o.type == 'CHART' || o.type == 'COUNTER';
        });

        if ( vis ) {
          cb(null, vis.id);
        } else {
          cb(`No visualisation with type "CHART" or "COUNTER" for graph id ${id}`);
        }
      }
    });
  }
}

/**
 * Update available charts on redash. When create a new query in redash, launch it to propose it on slack.
 * @param  {[type]}   redashHostAlias
 * @param  {[type]}   redashApiKey
 * @param  {Function} cb             Call back function called when finish.
 */
function updateAvailableCharts(redashHostAlias, redashApiKey, cb) {
  const queryUrl = `${redashHostAlias}/api/queries?api_key=${redashApiKey}`;

  request.get(queryUrl, (err, resp, body) => {
    var msg = "";

    if (err) {
      msg = `Something wrong getting queries : ${err}`;
    } else if (resp.statusCode != 200) {
      msg = `Something wrong getting queries. Status code : ${resp.statusCode}`;
    } else {
      var queries = JSON.parse(body);

      if ( !queries.results ) {
        msg = "No queries";
      } else {
        msg = "You can choose between:\n";
        graphs = {};

        var results = _.sortBy(queries.results, [function(o) { return o.name; }]);

        for ( var i = 0 ; i < results.length ; i++ ) {
           msg += "- "+results[i].name+"\n";
           graphs[results[i].name] = results[i].id;
        }

        msg += '\nSay me "show" + graph name. e.g: "show '+results[0].name+'"';
      }

      console.log(`Charts list updated! (${results.length} charts)`);
    }

    if ( cb ) {
      cb(err, msg);
    }
  });
}
