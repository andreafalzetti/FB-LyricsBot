'use strict';

var config = require('./config');
var bodyParser = require('body-parser');
var express = require('express');
var request = require('request');
var colors = require('colors');
var wit = require('node-wit');
var FacebookMessenger = require('fb-messenger');
var messenger = new FacebookMessenger(config.facebook.PAGE_ACCESS_TOKEN);
var music = require('musicmatch')({usertoken:"9a0072c42aca926eafd35539025fbd5b",format:"json",appid:"1409612576775"});

// Webserver parameter
const PORT = process.env.PORT || config.app.port;

// Wit.ai parameters
const WIT_TOKEN = process.env.WIT_TOKEN || config.wit.TOKEN;

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

// Subscribe to Facebook Webhook
function fb_subscribe() {    
    // Set the headers
    var headers = {
        'User-Agent':       'LyricsBot/0.0.1',
        'Content-Type':     'application/x-www-form-urlencoded'
    }

    // Configure the request
    var options = {
        url: 'https://graph.facebook.com/v2.6/me/subscribed_apps?access_token=' + config.facebook.PAGE_ACCESS_TOKEN,
        method: 'POST',
        headers: headers
    }
    
    console.log("Subscribing Facebook Messenger Webhook: ".white.bold + options.url);
    
    // Start the request
    request(options, function (error, response, body) {
        body = JSON.parse(body);
        //console.log(body);
        if (!error && response.statusCode == 200) {
            if(typeof body.success !== "undefined" && body.success === true) {
                console.log("Connection with Facebook successful".white.bold);
            }
        } else {                        
            console.log("Error Type: ".red.bold + body.error.type + " ["+ body.error.code +"]");
            console.log("Error Message: ".red.bold + body.error.message);        
            throw new Error("Error Connecting to Facebook");
        }
    })
}
fb_subscribe();

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

function getPostback(message) {
    if(typeof message.postback !== 'undefined' &&
       typeof message.postback.payload !== 'undefined') {
        return message.postback.payload;
    }
  return null;
    
    //VIEW_LYRICS_TRACK_32048913
}

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

function sendMessagesRecursively(sender, messages, index) {
    if(index < messages.length) {
        messenger.sendTextMessage(sender, messages[index], function (err, body) {
          if (err) {
            console.error(colors.red.bold("Error::sendMessagesRecursively"));
            console.error(err);
            return
          } else {
              console.log(colors.white.bold("Message ["+index+"/"+(messages.length-1)+"] Sent Successfully"));
              console.log(messages[index]);              
              index++;
              sendMessagesRecursively(sender, messages, index);              
          }          
        });        
    } 
}

// Message handler
app.post('/fb', (req, res) => {

  // Parsing the Messenger API response 
  const messaging = getFirstMessagingEntry(req.body);
  var postback = getPostback(messaging);
    // Yay! We got a new message!

    // We retrieve the Facebook user ID of the sender
    const sender = messaging.sender.id;

    // We retrieve the user's current session, or create one if it doesn't exist
    // This is needed for our bot to figure out the conversation history
    const sessionId = findOrCreateSession(sender);
  
  if(postback !== null) {
      console.log(colors.red("postback = " + postback));
      
      if(postback.indexOf("VIEW_LYRICS_TRACK") >= 0) {
         var trackId = postback.substring("VIEW_LYRICS_TRACK_".length, postback.length);
          console.log("Requested Track_ID = " + colors.red(trackId));
          
           
            music.trackLyrics({track_id:trackId})
            .then(function(data){
                    var lyrics = data.message.body.lyrics.lyrics_body;
                    console.log("Length: " + colors.white.bold(lyrics.length))
                    console.log(colors.white(lyrics));
                
                    var lyrics_split = lyrics.match(/.{1,320}/g);
                    var lyrics_packages = new Array();
                    var _tmpCount = 0;
                    var _msg = "";
                    for(var i=0; i<lyrics_split.length; i++) {
                        _tmpCount += lyrics_split[i].length;
                        if((_tmpCount+lyrics_split[i].length) <= 320) {
                           _msg += lyrics_split[i] + "\n";
                        } else {
                           //_msg += "\n";
                           lyrics_packages.push(_msg); 
//                           _msg = "";
                           _msg = lyrics_split[i] + "\n";
                           _tmpCount = _msg.length;
                        }
                    }
                    if(_msg !== "") {
                        lyrics_packages.push(_msg);
                    }
                    console.log(lyrics_packages);
                    console.log(colors.white.bold("Lyrics has been splitted in " + lyrics_packages.length + " messages"));
                    //console.log(lyrics_split);
                    sendMessagesRecursively(sender, lyrics_packages, 0);
                    /*lyrics_packages.forEach(function(lyric_package){
                                         
                        messenger.sendTextMessage(sender, lyric_package, function (err, body) {
                          if (err) {
                            console.error(colors.red.bold("Error"));
                            console.error(err);
                            return
                          }
                          console.log(body);
                        });
                    });*/
            }).catch(function(err){
                    console.log(err);
            })

          
      }
  }    
  else if (messaging && messaging.message && messaging.recipient.id === FB_PAGE_ID) {


    // We retrieve the message content
    const msg = messaging.message.text;
    const atts = messaging.message.attachments;

    if (atts) {
        // We received an attachment
        console.log(colors.magenta("Attachment Received ["+atts[0].type+"]"));
        console.log(atts[0].payload);
        
      // Let's reply with an automatic message
      fbMessage(
        sender,
        'Sorry I can only process text messages for now.'
      );
    } else if (msg) {
      // We received a text message
        console.log("<" + colors.white(sender) + ">: " + colors.white.bold(msg));        
        
        music.trackSearch({q:msg, page:1, page_size:10})
        .then(function(data){
                
                console.log("Found " + colors.white(data.message.body.track_list.length).bold + " lyrics");
                //console.log(data.message.body.track_list);
                if(data.message.body.track_list.length === 0) {
                    messenger.sendTextMessage(sender, "Sorry but I couldn't find any lyric.", function (err, body) {
                      if (err) {
                        console.error(colors.red.bold("Error"));
                        console.error(err);
                        return
                      } else {
                          console.log(colors.white.bold("Message [Lyric Not Found] Sent Successfully"));
                      }
                    })                    
                }
                else if(data.message.body.track_list.length > 1) {
                    
                    
//                    var buttons = [{
//                                    "type":"web_url",
//                                    "url":"https://petersapparel.parseapp.com/view_item?item_id=100",
//                                    "title":"View Item"
//                                  },
//                                  {
//                                    "type":"web_url",
//                                    "url":"https://petersapparel.parseapp.com/buy_item?item_id=100",
//                                    "title":"Buy Item"
//                                  },
//                                  {
//                                    "type":"postback",
//                                    "title":"Bookmark Item",
//                                    "payload":"USER_DEFINED_PAYLOAD_FOR_ITEM100"
//                                  }];
//                 
                    
                    var tracks  = new Array();
                    data.message.body.track_list.forEach(function(data) {
                       var track = data.track;
                       var cover = "http://s.mxmcdn.net/images/albums/nocover.png";
                    
                       if(typeof track.album_coverart_800x800 !== "undefined" && track.album_coverart_800x800 !== "") {
                           cover = track.album_coverart_800x800;
                       } else if(typeof track.album_coverart_500x500 !== "undefined" && track.album_coverart_500x500 !== "") {
                           cover = track.album_coverart_500x500;
                       } else if(typeof track.album_coverart_350x350 !== "undefined" && track.album_coverart_350x350 !== "") {
                           cover = track.album_coverart_350x350;
                       } else if(typeof track.album_coverart_100x100 !== "undefined" && track.album_coverart_100x100 !== "") {
                           cover = track.album_coverart_100x100;
                       }
                        
                       var _t = {
                                    "title": track.track_name + " - " + track.artist_name,
                                    "image_url": cover,
                                    "subtitle": track.album_name,
                                    "buttons":[
                                          {
                                            "type": "postback",                                            
                                            "title": "View Lyrics",
                                            "payload": "VIEW_LYRICS_TRACK_" + track.track_id,
                                          }
                                        ],
                           
                                } 
                       
                       
                    
                        tracks.push(_t);
                        
                    });
              
                    
                    // "What song you would like to get the lyrics for?"
                    messenger.sendHScrollMessage(sender, tracks, function (err, body) {
                      if (err) {
                        console.error(colors.red.bold("Error"));
                        console.error(err);
                        return
                      }
                      console.log(body)
                    })
                }
                              
            
        }).catch(function(err){
                console.log(err);
        });        
        

        
        // Let's forward the message to the Wit.ai Bot Engine
      // This will run all actions until our bot has nothing left to do
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