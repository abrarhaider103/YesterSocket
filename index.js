import express from "express";
import http from "http";
import path from "node:path";
import killable from "killable";
import { Server } from "socket.io";
import { getRoom, getRoomTwo, getNewToken, transformArgs } from "./utils.js";
import routes from "./routes.js";
const __dirname = path.resolve();

import Room from "./room.js";
global.nofusers = 0;

let window;
let server;
global.rooms = [];
global.mainserver = true;

getNewToken();
setInterval(getNewToken, 1000 * 60 * 10);

if (global.mainserver === true) {
  makeServer(process.env.PORT);
} else if (global.mainserver === false) {
  makeServer(process.env.PORT, false);
}

function makeServer(port, startIO) {
  const app = express();
  server = http.createServer(app);
  app.use(express.urlencoded());
  app.use(express.json());

  app.use("/", routes);
  app.post("/startstop", (req, res) => {
    if (req.body.function === "stop") {
      global.mainserver = false;
      res.end("true");
      global.server.kill(() => {
        makeServer(process.env.PORT, false);
      });
    } else {
      global.mainserver = true;
      res.end("true");
      global.server.kill(function () {
        makeServer(process.env.PORT);
      });
    }
  });

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
      global.nofusers = io.engine.clientsCount;
      let url = socket.handshake.url;
      let args = transformArgs(url);
      let room = null;
      var extraData = JSON.parse(args.extra);

      function disconnect() {
        global.nofusers = io.engine.clientsCount;

        try {
          if (room === null) return;

          io.to(room.id).emit("user-disconnected", args.userid);

          if (room.owner.userid === args.userid) {
            console.log("asd");
            for (let i = 0; i < global.rooms.length; i++) {
              if (global.rooms[i].id === room.id) {
                global.rooms.splice(i, 1);
                break;
              }
            }

            for (let i = 0; i < profile_rooms[room.game_id].length; i++) {
              if (profile_rooms[room.game_id][i].isAdmin === false) {
                  io.to(profile_rooms[room.game_id][i].id).emit("room-closed", room.sessionid);
                  profile_rooms[room.game_id].splice(i, 1);
              }
            }
            
          }
          //   room.current = room.users.length;

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
      }
      socket.on("disconnect", disconnect);

      socket.on("close-entire-session", function (cb) {
        io.to(room.id).emit("closed-entire-session", args.sessionid, extraData);
        if (typeof cb === "function") cb(true);
      });
      socket.on("open-room", function (data, cb) {
        room = getRoomTwo(data.extra.game_id);
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
        } else {
          io.to(room.id).emit(
            "closed-entire-session",
            args.sessionid,
            extraData
          );
          global.rooms.splice(global.rooms.indexOf(room), 1);
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
