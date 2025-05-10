import express from "express";
import http from "http";
//const https = require('https');
import path from "node:path";
import killable from "killable";
import Twilio from "twilio";
import { Server } from "socket.io";
const __dirname = path.resolve();
import config from "./config.json" assert { type: "json" };
if (process.env.NP_PASSWORD) {
  config = {
    passwordforserver: process.env.NP_PASSWORD,
  };
}
import Room from "./room.js";
let nofusers = 0;

let window;
let server;
/** @type {Room[]} */
global.rooms = [];
let mainserver = true;
let cachedToken = null;
let getNewToken;

if (config.TWILIO_ACCOUNT_SID) {
  const twilio = Twilio(
    config.TWILIO_ACCOUNT_SID || "",
    config.TWILIO_AUTH_TOKEN || ""
  );
  getNewToken = function () {
    twilio.tokens.create({}, function (err, token) {
      if (!err && token) {
        cachedToken = token;
      }
    });
  };
} else {
  getNewToken = function () {
    throw new Error("Missing twilto information. Cannot run!");
  };
}
// fetch token initially
getNewToken();
// refetch new token every 15 mins and save to cache
setInterval(getNewToken, 1000 * 60 * 10);

/**
 * Get the specified room, or return null if not found
 * @param {string} domain
 * @param {number} game_id
 * @param {string} sessionid
 * @return {Room}
 */
function getRoom(domain, game_id, sessionid) {
  for (let i = 0; i < global.rooms.length; i++) {
    if (global.rooms[i].id === domain + ":" + game_id + ":" + sessionid) {
      return global.rooms[i];
    }
  }
  return null;
}
function getRoomTwo(game_id) {
    for (let i = 0; i < global.rooms.length; i++) {
      if (global.rooms[i].game_id === game_id) {
        return global.rooms[i];
      }
    }
    return null;
  }

if (mainserver === true) {
  makeServer(process.env.PORT);
} else if (mainserver === false) {
  makeServer(process.env.PORT, false);
}

/**
 * Check if the authorization is valid
 * @param {string} authorization
 * @param {string} passwordforserver
 * @returns {boolean}
 */
function checkAuth(authorization, passwordforserver) {
  if (!authorization) return false;
  const [username, password] = Buffer.from(
    authorization.replace("Basic ", ""),
    "base64"
  )
    .toString()
    .split(":");
  return true;
  return username === "admin" && password === passwordforserver;
}

/**
 * Create a server on the specified port
 * @param {number} port
 * @param {boolean} startIO
 */
function makeServer(port, startIO) {
  const app = express();
  server = http.createServer(app);
  app.use(express.urlencoded());
  app.use(express.json());
  app.get("/", (req, res) => {
    const reject = () => {
      res.setHeader("www-authenticate", "Basic");
      res.sendStatus(401);
    };
    if (!checkAuth(req.headers.authorization, config.passwordforserver)) {
      return reject();
    }
    res.sendFile(path.join(__dirname + "/index.html"));
  });
  app.get("/img/:imageName", function (req, res) {
    const image = req.params["imageName"];
    try {
      res.sendFile(path.join(__dirname + "/img/" + image));
    } catch (err) {
      res.sendStatus(401);
    }
  });
  app.post("/startstop", (req, res) => {
    const reject = () => {
      res.setHeader("www-authenticate", "Basic");
      res.sendStatus(401);
    };
    if (!checkAuth(req.headers.authorization, config.passwordforserver)) {
      return reject();
    }

    if (req.body.function === "stop") {
      mainserver = false;
      res.end("true");
      server.kill(() => {
        makeServer(process.env.PORT, false);
      });
    } else {
      mainserver = true;
      res.end("true");
      server.kill(function () {
        makeServer(process.env.PORT);
      });
    }
  });
  app.post("/check", (req, res) => {
    const reject = () => {
      res.setHeader("www-authenticate", "Basic");
      res.sendStatus(401);
    };
    if (!checkAuth(req.headers.authorization, config.passwordforserver)) {
      return reject();
    }
    res.end(mainserver.toString());
  });
  app.post("/numusers", (req, res) => {
    const reject = () => {
      res.setHeader("www-authenticate", "Basic");
      res.sendStatus(401);
    };
    if (!checkAuth(req.headers.authorization, config.passwordforserver)) {
      return reject();
    }
    res.end('{ "users": ' + nofusers + " }");
  });

  //MYCODE
  app.post("/create-room", (req, res) => {
    const { domain, game_id, room_name, maxParticipants, password, adminuser } =
      req.body;

    if (!domain || !game_id || !room_name) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const sessionid = `${domain}:${game_id}:${Date.now()}`;
    const newRoom = new Room(
      domain,
      game_id,
      sessionid,
      room_name,
      maxParticipants || 4,
      0,
      password || "",
      adminuser || "admin",
      null,
      {},
      1
    );

    global.rooms.push(newRoom);

    return res.json({
      message: "Room created successfully",
      sessionid: sessionid,
      room_name: room_name,
      maxParticipants: maxParticipants || 4,
      password: password ? true : false,
    });
  });

  app.delete("/delete-room", (req, res) => {
    const { sessionid } = req.body;
    if (!sessionid) {
      return res.status(400).json({ error: "Missing sessionid parameter" });
    }
    const roomIndex = global.rooms.findIndex(
      (room) => room.game_id === sessionid
    );
    if (roomIndex === -1) {
      return res.status(404).json({ error: "Room not found" });
    }
    global.rooms.splice(roomIndex, 1);
    return res.json({ message: "Room deleted successfully", sessionid });
  });

  app.get("/room-list", (req, res) => {
    let roomList = global.rooms.map((room) => {
      console.log("BRRRRR::::", room);
      var res = {
        sessionid: room.id,
        room_name: room.name,
        domain: room.domain,
        game_id: room.game_id,
        maxParticipants: room.max,
        currentParticipants: room.current,
        hasPassword: !!room.password,
        coreVer: room.coreVer,
      };
      if (room.users) {
        res.participants = room.users.map((user) => ({
          userid: user.userid,
          extra: user.extra || {},
        }));
      }

      return res;
    });
    res.json(roomList);
  });

  //MYCODE

  if (startIO !== false) {
    const profile_rooms = {};
    const io = new Server(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true,
      },
    });

    io.on("connection", (socket) => {
      nofusers = io.engine.clientsCount;
      let url = socket.handshake.url;
      let args = transformArgs(url);
      let room = null;
      var extraData = {};
      try {
        extraData = JSON.parse(args.extra);
      } catch (e) {
        console.warn(e);
      }

      app.get("/webrtc", (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json");

        const iceServers = [
            {
                urls: "stun:13.50.120.137:3478"
            },
            {
                urls: "turn:13.50.120.137:3478?transport=udp",
                username: "demostun",
                credential: "demostun123"
            },
            {
                urls: "turn:13.50.120.137:3478?transport=tcp",
                username: "demostun",
                credential: "demostun123"
            }
        ];

        // const iceServers = [
        //     {
        //       url: "stun:13.50.120.137:3478",
        //       urls: "stun:13.50.120.137:3478"
        //     },
        //     {
        //       url: "turn:13.50.120.137:3478?transport=udp",
        //       urls: "turn:13.50.120.137:3478?transport=udp",
        //       username: "demostun",
        //       credential: "demostun123"
        //     },
        //     {
        //       url: "turn:13.50.120.137:3478?transport=tcp",
        //       urls: "turn:13.50.120.137:3478?transport=tcp",
        //       username: "demostun",
        //       credential: "demostun123"
        //     }
        //   ];
          

          
          res.json(iceServers);
      });
      app.get("/list", function (req, res) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json");
        let args = transformArgs(req.url);
        if (!args.game_id || !args.domain || !args.coreVer) {
          res.end("{}");
          return;
        }
        args.game_id = parseInt(args.game_id);
        args.coreVer = parseInt(args.coreVer);
        let rv = {};
        for (let i = 0; i < global.rooms.length; i++) {
          // if (global.rooms[i].domain !== args.domain ||
          //     global.rooms[i].game_id !== args.game_id ||
          //     global.rooms[i].coreVer !== args.coreVer) continue;
          console.log(args.userid);
          global.rooms[i].changeOwner(args.userid);
          rv[global.rooms[i].sessionid] = {
            owner_name: global.rooms[i]?.owner?.extra?.name || "",
            room_name: global.rooms[i].name,
            country: "US",
            max: global.rooms[i].max,
            current: global.rooms[i].current,
            password: global.rooms[i].password.trim() ? 1 : 0,
          };
        }
        res.end(JSON.stringify(rv));
      });
      app.get("/room-detail", (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json");

        const { game_id } = req.query;

        if (!game_id) {
          return res
            .status(400)
            .json({
              error:
                "Game Owner has not started the game. Please try again later.",
            });
        }
        if (!Array.isArray(global.rooms)) {
          return res
            .status(500)
            .json({
              error:
                "Game Owner has not started the game. Please try again later.",
            });
        }
        const room = global.rooms.find((room) => {
          return room?.game_id === game_id;
        });
        if (!room) {
          return res
            .status(404)
            .json({
              error:
                "Game Owner has not started the game. Please try again later.",
            });
        }

        const roomSafe = {
          ...room,
          users: room.users.map((user) => ({
            userid: user.userid,
            extra: user.extra,
          })),
          owner: {
            userid: room.owner.userid,
            extra: room.owner.extra,
          },
        };

        return res.json(roomSafe);
      });

      function disconnect() {
        nofusers = io.engine.clientsCount;
        try {
          if (room === null) return;
          io.to(room.id).emit("user-disconnected", args.userid);
          for (let i = 0; i < room.users.length; i++) {
            if (room.users[i].userid === args.userid) {
              room.users.splice(i, 1);
              break;
            }
          }
          if (!room.users[0]) {
            for (let i = 0; i < global.rooms.length; i++) {
              if (global.rooms[i].id === room.id) {
                global.rooms.splice(i, 1);
              }
            }
          } else {
            if (room.owner.userid === args.userid) {
              room.owner = room.users[0];
              room.owner.socket.emit("set-isInitiator-true", args.sessionid);
            }
            room.current = room.users.length;
          }
          socket.leave(room.id);
          room = null;
        } catch (e) {
          console.warn(e);
        }

        socket.emit("disconnect-all-user", args.sessionid);
      }
      socket.on("disconnect", disconnect);

      socket.on("close-entire-session", function (cb) {
        io.to(room.id).emit("closed-entire-session", args.sessionid, extraData);
        if (typeof cb === "function") cb(true);
      });
      socket.on("open-room", function (data, cb) {
        //search for room
        room = getRoomTwo( data.extra.game_id);
        if (room === null) {
            room = new Room(
                data.extra.domain,
                data.extra.game_id,
                args.sessionid,
                data.extra.room_name,
                args.maxParticipantsAllowed,
                1,
                data.password.trim(),
                args.userid,
                socket,
                data.extra,
                args.coreVer
              );
              global.rooms.push(room);
        }else{

            for (let i = 0; i < room.users.length; i++) {
                room.users.splice(i, 1);
              }
            
        }
        
        extraData = data.extra;

        socket.emit("extra-data-updated", null, extraData);
        socket.emit("extra-data-updated", args.userid, extraData);

        socket.join(room.id);
        cb(true, undefined);
      });
      socket.on("check-presence", function (roomid, cb) {
        cb(
          getRoom(extraData.domain, extraData.game_id, roomid) !== null,
          roomid,
          null
        );
      });
      socket.on("join-room", function (data, cb) {
        room = getRoom(data.extra.domain, data.extra.game_id, data.sessionid);

        if (room === null) {
          cb(false, "USERID_NOT_AVAILABLE");
          return;
        }
        if (room.current >= room.max) {
          cb(false, "ROOM_FULL");
          return;
        }
        if (room.hasPassword && !room.checkPassword(data.password)) {
          cb(false, "INVALID_PASSWORD");
          return;
        }

        room.users.forEach((user) => {
          socket.to(room.id).emit("netplay", {
            remoteUserId: user.userid,
            message: {
              newParticipationRequest: true,
              isOneWay: false,
              isDataOnly: true,
              localPeerSdpConstraints: {
                OfferToReceiveAudio: false,
                OfferToReceiveVideo: false,
              },
              remotePeerSdpConstraints: {
                OfferToReceiveAudio: false,
                OfferToReceiveVideo: false,
              },
            },
            sender: args.userid,
            extra: extraData,
          });
        });
        data.extra.room_name = room.name;

        room.addUser({
          userid: args.userid,
          socket,
          extra: data.extra,
        });

        socket.to(room.id).emit("user-connected", args.userid);
        socket.join(room.id);

        cb(true, null);
      });
      socket.on("set-password", function (password, cb) {
        if (room === null) {
          if (typeof cb === "function") cb(false);
          return;
        }
        if (typeof password === "string" && password.trim()) {
          room.password = password;
          room.hasPassword = true;
        } else {
          room.password = password.trim();
          room.hasPassword = false;
        }
        if (typeof cb === "function") cb(true);
      });
      socket.on("changed-uuid", function (newUid, cb) {
        if (room === null) {
          if (typeof cb === "function") cb(false);
          return;
        }
        for (let i = 0; i < room.users.length; i++) {
          if (room.users[i].userid === args.userid) {
            room.users[i].userid = newUid;
            break;
          }
        }
        if (typeof cb === "function") cb(true);
      });
      socket.on("disconnect-with", function (userid, cb) {
        //idk
        if (typeof cb === "function") cb(true);
      });
      socket.on("netplay", function (msg) {
        if (room === null) return;
        const outMsg = JSON.parse(JSON.stringify(msg));
        outMsg.extra = extraData;
        socket.to(room.id).emit("netplay", outMsg);
        if (msg && msg.message && msg.message.userLeft === true) disconnect();
      });
      socket.on("extra-data-updated", function (msg) {
        if (room === null) return;
        let outMsg = JSON.parse(JSON.stringify(msg));
        outMsg.country = "US";
        extraData = outMsg;

        for (let i = 0; i < room.users.length; i++) {
          if (room.users[i].userid === args.userid) {
            room.users[i].extra = extraData;
            break;
          }
        }

        io.to(room.id).emit("extra-data-updated", args.userid, outMsg);
      });
      socket.on("get-remote-user-extra-data", function (id) {
        if (room === null) return;
        for (let i = 0; i < room.users.length; i++) {
          if (room.users[i].userid === id) {
            socket.emit("extra-data-updated", room.users[i].extra);
          }
        }
      });

      socket.on("join", (userData) => {
        const { name, email, pic, sessionID, isAdmin } = userData;
        if (!profile_rooms[sessionID]) profile_rooms[sessionID] = [];
        const existingUserIndex = profile_rooms[sessionID].findIndex(
          (u) => u.email === email
        );

        if (existingUserIndex !== -1) {
          profile_rooms[sessionID][existingUserIndex].id = socket.id;
          socket.join(sessionID);
          socket.sessionID = sessionID;
          io.to(sessionID).emit("userList", profile_rooms[sessionID]);
          return;
        }

        // if (profile_rooms[sessionID].length >= 4) {
        //   socket.emit("roomFull");
        //   return;
        // }

        userData.id = socket.id;
        userData.isAdmin = isAdmin;
        socket.join(sessionID);
        socket.sessionID = sessionID;

        profile_rooms[sessionID].push(userData);

        io.to(sessionID).emit("userList", profile_rooms[sessionID]);
      });

      socket.on("message", ({ text, sessionID }) => {
        io.to(sessionID).emit("message", text);
      });

      socket.on("kickUser", ({ userId, sessionID }) => {
        const kicker = profile_rooms[sessionID]?.find(
          (u) => u.id === socket.id
        );
        if (!kicker || !kicker.isAdmin) return;

        const userToKick = profile_rooms[sessionID]?.find(
          (u) => u.id === userId
        );
        if (userToKick) {
          profile_rooms[sessionID] = profile_rooms[sessionID].filter(
            (u) => u.id !== userId
          );
          io.to(userId).emit("kicked");
          io.to(sessionID).emit("userList", profile_rooms[sessionID]);
        }
      });

      socket.on("disconnect-user", () => {
        if (!socket.sessionID) return;
        const userIndex = profile_rooms[socket.sessionID].findIndex(
          (u) => u.id === socket.id
        );
        if (userIndex !== -1) {
          profile_rooms[socket.sessionID].splice(userIndex, 1);
          io.to(socket.sessionID).emit(
            "userList",
            profile_rooms[socket.sessionID]
          );
        }
      });
    });
  }

  server.listen(port || 3000, "0.0.0.0", () => {
    console.log("The Main Server is now running on port :" + (port || 3000));
  });
  killable(server);
}

/**
 * Get the arguments from a url
 * @param {string} url
 * @return {object}
 */
function transformArgs(url) {
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
}
