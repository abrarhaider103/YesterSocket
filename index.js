import express from "express";
import http from "http";
import fs from "fs";
import https from "https";
import path from "node:path";
import killable from "killable";
import { Server } from "socket.io";
import { getRoom, getRoomTwo, getNewToken, transformArgs } from "./utils.js";
import routes from "./routes.js";
const options = {
  // key: fs.readFileSync('/opt/bitnami/letsencrypt/certificates/ws.yester.games.key'),
  // cert: fs.readFileSync('/opt/bitnami/letsencrypt/certificates/ws.yester.games.crt')
};
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
    const io = new Server(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true,
      },
    });
    const group_rooms = {};

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
            for (let i = 0; i < global.rooms.length; i++) {
              if (global.rooms[i].id === room.id) {
                global.rooms.splice(i, 1);
                break;
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







      //audio
      console.log('User connected:', socket.id);
      socket.on('join', ({ room, userName, isAdmin, profilePic }) => {
        // Check if admin is present in the room
        const hasAdmin = group_rooms[room]?.some(user => user.isAdmin);
        if (!isAdmin && !hasAdmin) {
          console.log(`Join rejected for ${userName} in room ${room}: Admin has not yet joined.`);
          socket.emit('join-rejected', 'Admin has not yet joined.');
          socket.disconnect(true);
          return;
        }
    
        socket.join(room);
        console.log(`${userName} joined room ${room} as ${isAdmin ? 'admin' : 'member'}`);
    
        if (!group_rooms[room]) {
          group_rooms[room] = [];
        }
    
        // Check for existing user with the same userName
        const existingUser = group_rooms[room].find(u => u.userName === userName && u.id !== socket.id);
        if (existingUser) {
          console.log(`Kicking existing user ${userName} (id: ${existingUser.id}) from room ${room}`);
          group_rooms[room] = group_rooms[room].filter(u => u.id !== existingUser.id);
          io.to(existingUser.id).emit('kicked');
          socket.to(room).emit('user-left', { id: existingUser.id });
          io.sockets.sockets.get(existingUser.id)?.leave(room);
        }
    
        // Add new user
        group_rooms[room].push({ id: socket.id, userName, isAdmin, muted: false, profilePic });
    
        socket.to(room).emit('user-joined', { id: socket.id, userName, isAdmin, profilePic });
        io.to(room).emit('participants', group_rooms[room]);
    
        socket.on('signal', ({ to, data }) => {
          io.to(to).emit('signal', { from: socket.id, data });
        });
    
        socket.on('mute-user', ({ room, id, muted }) => {
          const user = group_rooms[room]?.find(u => u.id === socket.id);
          if (user && user.isAdmin) {
            const targetUser = group_rooms[room]?.find(u => u.id === id);
            if (targetUser && !targetUser.isAdmin) {
              targetUser.muted = muted;
              io.to(room).emit('mute-user', { id, muted });
              io.to(room).emit('participants', group_rooms[room]);
              console.log(`${userName} ${muted ? 'muted' : 'unmuted'} ${targetUser.userName} in room ${room}`);
            }
          }
        });
    
        socket.on('self-mute', ({ room, id, muted }) => {
          const user = group_rooms[room]?.find(u => u.id === id);
          if (user) {
            user.muted = muted;
            io.to(room).emit('mute-user', { id, muted });
            io.to(room).emit('participants', group_rooms[room]);
            console.log(`${user.userName} ${muted ? 'muted' : 'unmuted'} themselves in room ${room}`);
          }
        });
    
        socket.on('kick-user', ({ room, id }) => {
          const user = group_rooms[room]?.find(u => u.id === socket.id);
          if (user && user.isAdmin) {
            const targetUser = group_rooms[room]?.find(u => u.id === id);
            if (targetUser && !targetUser.isAdmin) {
              console.log(`${userName} kicked ${targetUser.userName} from room ${room}`);
              group_rooms[room] = group_rooms[room].filter(u => u.id !== id);
              io.to(id).emit('kicked');
              socket.to(room).emit('user-left', { id });
              io.to(room).emit('participants', group_rooms[room]);
              io.sockets.sockets.get(id)?.leave(room);
            }
          }
        });
    
        socket.on('leave-room', ({ room, id }) => {
          if (group_rooms[room]) {
            const user = group_rooms[room].find(u => u.id === id);
            if (user) {
              console.log(`${user.userName} left room ${room}`);
              if (user.isAdmin) {
                io.to(room).emit('room-closed');
                group_rooms[room].forEach(u => {
                  io.to(u.id).emit('user-left', { id: u.id });
                });
                delete group_rooms[room];
                socket.to(room).emit('participants', []);
              } else {
                group_rooms[room] = group_rooms[room].filter(u => u.id !== id);
                socket.to(room).emit('user-left', { id });
                io.to(room).emit('participants', group_rooms[room]);
                if (group_rooms[room].length === 0) {
                  delete group_rooms[room];
                }
              }
            }
            socket.leave(room);
          }
        });
    
        socket.on('start-call', (room) => {
          const user = group_rooms[room]?.find(u => u.id === socket.id);
          if (user && user.isAdmin) {
            io.to(room).emit('call-started');
          }
        });
    
        socket.on('end-call', (room) => {
          const user = group_rooms[room]?.find(u => u.id === socket.id);
          if (user && user.isAdmin) {
            io.to(room).emit('call-ended');
          }
        });
    
        socket.on('disconnect', () => {
          console.log('User disconnected:', socket.id);
          for (const room in group_rooms) {
            if (group_rooms[room].some(user => user.id === socket.id)) {
              const user = group_rooms[room].find(u => u.id === socket.id);
              if (user) {
                console.log(`${user.userName} disconnected from room ${room}`);
                if (user.isAdmin) {
                  io.to(room).emit('room-closed');
                  group_rooms[room].forEach(u => {
                    io.to(u.id).emit('user-left', { id: u.id });
                  });
                  delete group_rooms[room];
                  socket.to(room).emit('participants', []);
                } else {
                  group_rooms[room] = group_rooms[room].filter(u => u.id !== socket.id);
                  socket.to(room).emit('user-left', { id: socket.id });
                  io.to(room).emit('participants', group_rooms[room]);
                  if (group_rooms[room].length === 0) {
                    delete group_rooms[room];
                  }
                }
              }
            }
          }
        });
      });
    });
  }

  server.listen(port || 3000, "0.0.0.0", () => {
    console.log("The Main Server is now running on port :" + (port || 3000));
  });
  killable(server);
}
