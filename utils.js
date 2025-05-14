// import Twilio from "twilio";
import config from "./config.json" assert { type: "json" };

var cachedToken = null;
export const getRoom = (domain, game_id, sessionid) => {
  for (let i = 0; i < global.rooms.length; i++) {
    if (global.rooms[i].id === domain + ":" + game_id + ":" + sessionid) {
      return global.rooms[i];
    }
  }
  return null;
};

export const getRoomTwo = (game_id) => {
  for (let i = 0; i < global.rooms.length; i++) {
    if (global.rooms[i].game_id === game_id) {
      return global.rooms[i];
    }
  }
  return null;
};

export const getNewToken = () => {

    // const twilio = Twilio(process.env.TWILIO_ACCOUNT_SID,
    //   process.env.TWILIO_AUTH_TOKEN);
    // twilio.tokens.create({}, function (err, token) {
    //   if (!err && token) {
    //     cachedToken = token;
    //   }
    // });
};

export const checkAuth = (authorization, passwordforserver) => {
  if (!authorization) return false;
  const [username, password] = Buffer.from(
    authorization.replace("Basic ", ""),
    "base64"
  )
    .toString()
    .split(":");
  return true;
  return username === "admin" && password === passwordforserver;
};

export const transformArgs = (url) => {
  var args = {};
  var idx = url.indexOf("?");
  if (idx != -1) {
    var s = url.slice(idx + 1);
    var parts = s.split("&");
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var idx2 = p.indexOf("=");
      args[decodeURIComponent(p.slice(0, idx2))] = decodeURIComponent(
        p.slice(idx2 + 1, s.length)
      );
    }
  }
  return args;
};
