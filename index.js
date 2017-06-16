"use strict";

const Botkit = require("botkit");
const webshot = require("webshot");
// const request = require("request");
const tempfile = require("tempfile");
const fs = require("fs");
const request = require("request");
var env = require('node-env-file');
env(__dirname + '/.env');

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




// var options = {
//   // streamType: "jpeg",
//   // "renderDelay" : 20000,
//     // phantomPath: "C:\\Users\\sdkca\\Desktop\\phantomjs-2.1.1-windows\\bin\\phantomjs.exe"
// };
// console.log('go go go')
// // Use webshot here with the options object as third parameter
// // Example :
// webshot('http://52.213.226.220/embed/query/3/visualization/7?api_key=PQ7Umy8PFljvYoJq9YezD8hJ1XMVUt8IoWJ2AVAY',
// 'ICICICICI.png', options, (err) => {
//   console.log('SAVED SAVED')
//     // screenshot now saved to google.png
// });
//





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



console.log('redashApiKeysPerHost');
console.log(redashApiKeysPerHost);


const controller = Botkit.slackbot({
  debug: false
});

controller.spawn({
  token: slackBotToken
}).startRTM();




controller.hears('hello',['direct_message','direct_mention','mention'],function(bot,message) {
  bot.reply(message,'Hello yourself.');
});


console.log('slackMessageEvents')
console.log(slackMessageEvents)



Object.keys(redashApiKeysPerHost).forEach((redashHost) => {


  console.log(`${redashHost}/queries/`)

  const redashHostAlias = redashApiKeysPerHost[redashHost]["alias"];
  const redashApiKey    = redashApiKeysPerHost[redashHost]["key"];

  controller.hears(`${redashHost}/queries/([0-9]+)#([0-9]+)`, slackMessageEvents, (bot, message) => {
    const originalUrl = message.match[0];
    const queryId = message.match[1];
    const visualizationId =  message.match[2];
    const queryUrl = `${redashHostAlias}/queries/${queryId}#${visualizationId}`;
    const embedUrl = `${redashHostAlias}/embed/query/${queryId}/visualization/${visualizationId}?api_key=${redashApiKey}`;

    bot.reply(message, `Taking screenshot of ${originalUrl}`);
    bot.botkit.log(queryUrl);
    bot.botkit.log(embedUrl);

console.log('queryUrl' + queryUrl)


    const outputFile = tempfile(".png");
    // const webshotOptions = {
    //   screenSize: {
    //     width: 720,
    //     height: 360
    //   },
    //   shotSize: {
    //     width: 720,
    //     height: "all"
    //   },
    //   renderDelay: 20000,
    //   timeout: 100000
    // };
    //
    // console.log('embedUrl')
    // console.log(embedUrl)


//
//
//     request(embedUrl, function (error, response, body) {
//   console.log('error:', error); // Print the error if one occurred
//   console.log('statusCode:', response && response.statusCode); // Print the response status code if a response was received
//   console.log('body:', body); // Print the HTML for the Google homepage.
// });
//

var Nightmare = require('nightmare');

 Nightmare()
 // .goto('http://52.213.226.220/embed/query/3/visualization/7?api_key=PQ7Umy8PFljvYoJq9YezD8hJ1XMVUt8IoWJ2AVAY')
 .goto(embedUrl)
 // .wait('.modebar-btn')
 .wait(10000)
 .screenshot(outputFile)
 .end()
 .then(function(){
   console.log("Screenshot Saved")


   console.log('message gound')
   console.log(outputFile)


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


 })


    // webshot(embedUrl, outputFile, webshotOptions, (err) => {
    //   if (err) {
    //     const msg = `Something wrong happend in take a screen capture : ${err}`;
    //     bot.reply(message, msg);
    //     return bot.botkit.log.error(msg);
    //   }
    //
    //   console.log('message gound')
    //   console.log(outputFile)
    //
    //
    //   bot.botkit.log.debug(outputFile);
    //   bot.botkit.log.debug(Object.keys(message));
    //   bot.botkit.log(message.user + ":" + message.type + ":" + message.channel + ":" + message.text);
    //
    //   const options = {
    //     token: slackBotToken,
    //     filename: `query-${queryId}-visualization-${visualizationId}.png`,
    //     file: fs.createReadStream(outputFile),
    //     channels: message.channel
    //   };
    //
    //   // bot.api.file.upload cannot upload binary file correctly, so directly call Slack API.
    //   request.post({ url: "https://api.slack.com/api/files.upload", formData: options }, (err, resp, body) => {
    //     if (err) {
    //       const msg = `Something wrong happend in file upload : ${err}`;
    //       bot.reply(message, msg);
    //       bot.botkit.log.error(msg);
    //     } else if (resp.statusCode == 200) {
    //       bot.botkit.log("ok");
    //     } else {
    //       const msg = `Something wrong happend in file upload : status code=${resp.statusCode}`;
    //       bot.reply(message, msg);
    //       bot.botkit.log.error(msg);
    //     }
    //   });
    // });
  });
});
