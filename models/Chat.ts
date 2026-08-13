import mongoose, { Schema, models } from "mongoose";

const AttachmentSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      required: true,
    },
  },
  { _id: false }
);

const MessageSchema = new Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    attachment: {
      type: AttachmentSchema,
      default: null,
    },
  },
  { _id: false }
);

const DocumentSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      required: true,
    },
    extractedText: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

const ChatSchema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: true,
    },

    mode: {
      type: String,
      enum: ["default", "exam", "assignment", "career"],
      default: "default",
    },

    messages: {
      type: [MessageSchema],
      default: [],
    },

    documents: {
      type: [DocumentSchema],
      default: [],
    },
  },
  { timestamps: true }
);

export default models.Chat || mongoose.model("Chat", ChatSchema);