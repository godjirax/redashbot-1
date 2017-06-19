# Slack Bot for redash.io

This is slack bot for [re:dash](https://redash.io).

# Fork project
- From https://github.com/hakobera/redashbot

## Features

- Update redash charts
  - Bot can read chart from queries on redash with "update" message.
    - example : `@redashbot update`
- Show list of redash charts
  - Bot can list of all queries with "list" message.
    - example : `@redashbot list`
- Take a screen capture of visualization
  - Bot can handle message format like `@botname <visualization URL>`
    - example: `@redashbot https://your-redash-server.example.com/queries/1#2`
  - Or by query name, with message format like `@botname show <query name>`
    - example: `@redashbot show `

![screenshot.png](./images/screenshot.png)

## Screenshots

- webshot makes empty pictures. This project use Nightmare [Nightmare](https://github.com/segmentio/nightmare) to do it. You have to install xvfb before.
