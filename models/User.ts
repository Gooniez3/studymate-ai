import mongoose, { Schema, models } from "mongoose";

const UserSchema = new Schema(
  {
    name: { type: String, required: true },

    email: {
      type: String,
      required: true,
      unique: true,
    },

    password: {
      type: String,
      default: null,
    },

    image: {
      type: String,
      default: null,
    },

    emailVerified: {
      type: Boolean,
      default: false,
    },

    verificationCode: {
      type: String,
      default: null,
    },

    verificationCodeExpires: {
      type: Date,
      default: null,
    },

    resetPasswordToken: {
      type: String,
      default: null,
    },

    resetPasswordExpires: {
      type: Date,
      default: null,
    },

    passwordUpdatedAt: {
      type: Date,
      default: null,
    },

    defaultMode: {
      type: String,
      enum: ["default", "exam", "assignment", "career"],
      default: "default",
    },

    webSearchDefault: {
      type: Boolean,
      default: false,
    },

    theme: {
      type: String,
      enum: ["dark", "light", "system"],
      default: "dark",
    },
  },
  { timestamps: true }
);

export default models.User || mongoose.model("User", UserSchema);