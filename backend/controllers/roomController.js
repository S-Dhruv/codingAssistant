import { nanoid } from "nanoid";
import { users, rooms } from "../sharedState/sharedState.js";
import nodemailer from "nodemailer";
import RoomHistory from "../models/RoomHistory.js";
import chatHistory from "../models/chatRoom.js";

export async function joinRoom(req, res) {
  const { userId } = req.body;
  const { roomCode } = req.body;
  if (rooms[roomCode] == null)
    return res.status(404).json({ message: "Room not found", success: false });
  rooms[roomCode].push(userId);
  users[userId] = roomCode;
  const foundRoom = await RoomHistory.findOne({roomCode});
  const foundChat = await chatHistory.findOne({roomId : roomCode});
  if(!foundRoom||!foundChat)  
    return res.status(401).json({
      message : "Enter a valid room"
    }); 
  foundRoom.events.push({
    userId : userId,
    action : "join",
    time : Date.now()
  });
  foundChat.users.push(userId);
  await foundChat.save();
  await foundRoom.save();
  res
    .status(200)
    .json({ message: `User Joined ${userId} - ${userId} `, success: true });
}

export async function createRoom(req, res) {
  const { userId } = req.body;
  //room create DB
  console.log("userId",userId);
  try {
    const roomCode = nanoid(8);
    rooms[roomCode] = [];
    rooms[roomCode].push(userId);
    users[userId] = roomCode;
    await RoomHistory.create({roomCode});
    await chatHistory.create({roomId : roomCode});
    const foundRoom = await RoomHistory.findOne({roomCode});
    const foundChat = await chatHistory.findOne({roomId : roomCode});
    foundRoom.events.push({
      userId,
      action : "join",
      time : Date.now()
    });
    foundChat.users.push(userId);
    await foundRoom.save();
    await foundChat.save();
    return res
      .status(200)
      .json({ message: `Room created `, roomCode, success: true });
  } catch (err) {
    return res.status(500).json({ message: "Error", success: false });
  }
}

export const sendCode = async (req, res) => {
  try {
    const { roomCode, email } = req.body;
    console.log("Received request to send code:", { roomCode, email });

    // Create a transporter using nodemailer
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "theguywhoapproves@gmail.com",
        pass: "bkpt okmx dkfh frmu",
      },
    });

    // Email content
    const mailOptions = {
      from: "theguywhoapproves@gmail.com",
      to: email,
      subject: "Your Room Code for CodeCollab",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4F46E5;">Welcome to CodeCollab!</h2>
          <p>Here is your room code to join the collaborative coding session:</p>
          <div style="background-color: #1F2937; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="color: #fff; margin: 0;">Room Code: ${roomCode}</h3>
          </div>
          <p>You can use this code to join the room and start coding with your team.</p>
          <p>Happy coding!</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log("Email sent successfully");
    res.json({ message: "Email sent successfully" });
  } catch (error) {
    console.error("Error sending email:", error);
    res
      .status(500)
      .json({ message: "Error sending email", error: error.message });
  }
};
