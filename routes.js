// routes.js
import express from "express";
import path from "node:path";
import Room from "./room.js";
import Twilio from 'twilio';
import { getRoom, getRoomTwo, transformArgs } from "./utils.js";
import config from './config.json' assert { type: 'json' };

const router = express.Router();
const __dirname = path.resolve();

let cachedToken = null;
let nofusers = 0;


let getNewToken;

if (config.TWILIO_ACCOUNT_SID) {
    const twilio = Twilio(config.TWILIO_ACCOUNT_SID || "", config.TWILIO_AUTH_TOKEN || "");
    getNewToken = function() {
        twilio.tokens.create({}, function(err, token) {
            if (!err && token) {
                cachedToken = token;
            }
        });
    }
} else {
    getNewToken = function() {
        throw new Error("Missing twilto information. Cannot run!");
    }
}
getNewToken();
setInterval(getNewToken, 1000*60*10);


router.get("/", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  res.sendFile(path.join(__dirname + "/index.html"));
});

router.get("/img/:imageName", function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  const image = req.params["imageName"];
  try {
    res.sendFile(path.join(__dirname + "/img/" + image));
  } catch (err) {
    res.sendStatus(401);
  }
});

router.post("/check", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  res.end(global.mainserver.toString());
});

router.post("/numusers", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  res.end('{ "users": ' + global.nofusers + " }");
});

// Custom route to create room
router.post("/create-room", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
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
    password: !!password,
  });
});

router.delete("/delete-room", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
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

router.get("/room-list", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  let roomList = global.rooms.map((room) => {
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
    if (room.owner) {
      res.owner = {
        userid: room.owner.userid,
        extra: room.owner.extra || {},
      };
    }

    return res;
  });
  res.json(roomList);
});

router.get("/webrtc", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  // if (!cachedToken) {
  //   res.end("[]");
  // } else {
  //   res.json(cachedToken.iceServers);
  // }

  // const iceServers = [
  //   {
  //     urls: "stun:13.50.120.137:3478",
  //   },
  //   {
  //     urls: "turn:13.50.120.137:3478?transport=udp",
  //     username: "demostun",
  //     credential: "demostun123",
  //   },
  //   {
  //     urls: "turn:13.50.120.137:3478?transport=tcp",
  //     username: "demostun",
  //     credential: "demostun123",
  //   },
  // ];
  const iceServers = [
    { urls: "stun:stun.relay.metered.ca:80" },
    { urls: "turn:global.relay.metered.ca:80", username: "eb8ee60978a3c2d922e740e4", credential: "pN7rbCQTL/okDDQa" },
    { urls: "turn:global.relay.metered.ca:80?transport=tcp", username: "eb8ee60978a3c2d922e740e4", credential: "pN7rbCQTL/okDDQa" },
    { urls: "turn:global.relay.metered.ca:443", username: "eb8ee60978a3c2d922e740e4", credential: "pN7rbCQTL/okDDQa" },
    { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: "eb8ee60978a3c2d922e740e4", credential: "pN7rbCQTL/okDDQa" }
];
  res.json(iceServers);
});

router.get("/list", function (req, res) {
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
    rv[global.rooms[i].sessionid] = {
      owner_name: global.rooms[i].owner.extra.name,
      room_name: global.rooms[i].name,
      country: "US",
      max: global.rooms[i].max,
      current: global.rooms[i].current,
      password: global.rooms[i].password.trim() ? 1 : 0,
    };
  }
  res.end(JSON.stringify(rv));
});

router.get("/room-detail", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  const { game_id } = req.query;

  if (!game_id) {
    return res.status(400).json({
      error: "Game Owner has not started the game. Please try again later.",
    });
  }
  if (!Array.isArray(global.rooms)) {
    return res.status(500).json({
      error: "Game Owner has not started the game. Please try again later.",
    });
  }
  const room = global.rooms.find((room) => {
    return room?.game_id === game_id;
  });
  if (!room) {
    return res.status(404).json({
      error: "Game Owner has not started the game. Please try again later.",
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

export default router;
