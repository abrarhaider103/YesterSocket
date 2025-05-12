import { Server } from "socket.io";

export default function setupSocket(server, globalState) {
    const io = new Server(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true,
      },
    });
  
    let nofusers = 0;
    const profile_rooms = {};
  
    io.on("connection", (socket) => {

    });
  
    return io;
  }