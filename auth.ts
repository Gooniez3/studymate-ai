import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),

    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },

      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        await connectDB();

        const email = String(credentials.email).toLowerCase().trim();
        const password = String(credentials.password);

        const user = await User.findOne({ email });
        if (!user || !user.password) return null;

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) return null;

        if (!user.emailVerified) {
          throw new Error("EMAIL_NOT_VERIFIED");
        }

        return {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          image: user.image,
        };
      },
    }),
  ],

  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        await connectDB();

        const email = user.email?.toLowerCase().trim();
        if (!email) return false;

        const existing = await User.findOne({ email });

        if (!existing) {
          await User.create({
            name: user.name || "Google User",
            email,
            image: user.image,
            password: null,
            emailVerified: true,
          });
        }
      }

      return true;
    },

    async jwt({ token, user, account }) {
      if (user) {
        token.sub = user.id;
      }

      if (account?.provider === "google" && token.email) {
        await connectDB();

        const dbUser = await User.findOne({
          email: token.email.toLowerCase().trim(),
        });

        if (dbUser) {
          token.sub = dbUser._id.toString();
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }

      return session;
    },
  },

  session: {
    strategy: "jwt",
  },

  pages: {
    signIn: "/login",
  },
});