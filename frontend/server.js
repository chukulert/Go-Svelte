const path = require("path");
const express = require("express");
const app = require("./public/App.js");
const config = require("dotenv")
const server = express();

config.config({path:"./config/.env"})
const port = process.env.PORT
server.use(express.static(path.join(__dirname, "public")));

server.get("*", function(req, res) {
  const { html } = app.render({ url: req.url });

  res.write(`
    <!DOCTYPE html>
    <link rel='stylesheet' href='/global.css'>
    <link rel='stylesheet' href='/bundle.css'>
    <div id="app">${html}</div>
    <script src="/bundle.js"></script>
  `);

  res.end();
});

server.listen(port, () => console.log(`Listening on port ${port}`));
