'use strict';

var config = require('./config');
var FacebookMessenger = require('fb-messenger')
var messenger = new FacebookMessenger(config.facebook.PAGE_ACCESS_TOKEN);
const bodyParser = require('body-parser');
const express = require('express');
const request = require('request');
var colors = require('colors');

// Webserver parameter
const PORT = process.env.PORT || config.app.port;

// Wit.ai parameters
//const WIT_TOKEN = process.env.WIT_TOKEN;

// Messenger API parameters
const FB_PAGE_ID = process.env.FB_PAGE_ID && Number(process.env.FB_PAGE_ID) || Number(config.facebook.PAGE_ID);
if (!FB_PAGE_ID) {
  throw new Error('missing FB_PAGE_ID');
}
const FB_PAGE_TOKEN = process.env.FB_TOKEN || config.facebook.PAGE_ACCESS_TOKEN;
if (!FB_PAGE_TOKEN) {
  throw new Error('missing FB_PAGE_TOKEN');
}
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || config.facebook.FB_VERIFY_TOKEN;

// Starting our webserver and putting it all together
const app = express();
app.set('port', PORT);
app.listen(app.get('port'));
app.use(bodyParser.json());


// See the Send API reference
// https://developers.facebook.com/docs/messenger-platform/send-api-reference
const fbReq = request.defaults({
  uri: 'https://graph.facebook.com/me/messages',
  method: 'POST',
  json: true,
  qs: { access_token: FB_PAGE_TOKEN },
  headers: {'Content-Type': 'application/json'},
});

const fbMessage = (recipientId, msg, cb) => {
  const opts = {
    form: {
      recipient: {
        id: recipientId,
      },
      message: {
        text: msg,
      },
    },
  };
  fbReq(opts, (err, resp, data) => {
    if (cb) {
      cb(err || data.error && data.error.message, data);
    }
  });
};

// See the Webhook reference
// https://developers.facebook.com/docs/messenger-platform/webhook-reference
const getFirstMessagingEntry = (body) => {
  const val = body.object == 'page' &&
    body.entry &&
    Array.isArray(body.entry) &&
    body.entry.length > 0 &&
    body.entry[0] &&
    body.entry[0].id == FB_PAGE_ID &&
    body.entry[0].messaging &&
    Array.isArray(body.entry[0].messaging) &&
    body.entry[0].messaging.length > 0 &&
    body.entry[0].messaging[0]
  ;
  return val || null;
};

// Wit.ai bot specific code

// This will contain all user sessions.
// Each session has an entry:
// sessionId -> {fbid: facebookUserId, context: sessionState}
const sessions = {};

const findOrCreateSession = (fbid) => {
  let sessionId;
  // Let's see if we already have a session for the user fbid
  Object.keys(sessions).forEach(k => {
    if (sessions[k].fbid === fbid) {
      // Yep, got it!
      sessionId = k;
    }
  });
  if (!sessionId) {
    // No session found for user fbid, let's create a new one
    sessionId = new Date().toISOString();
    sessions[sessionId] = {fbid: fbid, context: {}};
  }
  return sessionId;
};

// Our bot actions
const actions = {
  say: (sessionId, msg, cb) => {
    // Our bot has something to say!
    // Let's retrieve the Facebook user whose session belongs to
    const recipientId = sessions[sessionId].fbid;
    if (recipientId) {
      // Yay, we found our recipient!
      // Let's forward our bot response to her.
      fbMessage(recipientId, msg, (err, data) => {
        if (err) {
          console.log(
            'Oops! An error occurred while forwarding the response to',
            recipientId,
            ':',
            err
          );
        }

        // Let's give the wheel back to our bot
        cb();
      });
    } else {
      console.log('Oops! Couldn\'t find user for session:', sessionId);
      // Giving the wheel back to our bot
      cb();
    }
  },
  merge: (context, entities, cb) => {
    cb(context);
  },
  error: (sessionid, msg) => {
    console.log('Oops, I don\'t know what to do.');
  },
  // You should implement your custom actions here
  // See https://wit.ai/docs/quickstart
};

// Webhook setup
app.get('/fb', (req, res) => {
  if (!FB_VERIFY_TOKEN) {
    throw new Error('missing FB_VERIFY_TOKEN');
  }
  if (req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === FB_VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(400);
  }
});

// Message handler
app.post('/fb', (req, res) => {
    //console.log("POST REQUEST!");
    //console.log(req);
  // Parsing the Messenger API response
  const messaging = getFirstMessagingEntry(req.body);
  if (messaging && messaging.message && messaging.recipient.id === FB_PAGE_ID) {
    // Yay! We got a new message!

    // We retrieve the Facebook user ID of the sender
    const sender = messaging.sender.id;

    // We retrieve the user's current session, or create one if it doesn't exist
    // This is needed for our bot to figure out the conversation history
    const sessionId = findOrCreateSession(sender);

    // We retrieve the message content
    const msg = messaging.message.text;
    const atts = messaging.message.attachments;
      
    if (atts) {
      // We received an attachment

      // Let's reply with an automatic message
      fbMessage(
        sender,
        'Sorry I can only process text messages for now.'
      );
    } else if (msg) {
      // We received a text message
        console.log("<" + colors.white(sender) + ">: " + colors.white.bold(msg));
        
messenger.sendTextMessage(sender, 'Hola', function (err, body) {
  if (err) {
    console.error(colors.red.bold(err));
    return
  }
  console.log(body)
})        
        
//      // Let's forward the message to the Wit.ai Bot Engine
//      // This will run all actions until our bot has nothing left to do
//      wit.runActions(
//        sessionId, // the user's current session
//        msg, // the user's message 
//        sessions[sessionId].context, // the user's current session state
//        (error, context) => {
//          if (error) {
//            console.log('Oops! Got an error from Wit:', error);
//          } else {
//            // Our bot did everything it has to do.
//            // Now it's waiting for further messages to proceed.
//            console.log('Waiting for futher messages.');
//
//            // Based on the session state, you might want to reset the session.
//            // This depends heavily on the business logic of your bot.
//            // Example:
//            // if (context['done']) {
//            //   delete sessions[sessionId];
//            // }
//
//            // Updating the user's current session state
//            sessions[sessionId].context = context;
//          }
//        }
//      );
    }
  }
  res.sendStatus(200);
});