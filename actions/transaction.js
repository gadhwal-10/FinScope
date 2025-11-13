"use server";              // MUST be line 1 — required by Next.js
export const runtime = "nodejs";  // MUST be line 2 or after "use server"

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { GoogleGenerativeAI } from "@google/generative-ai";
import aj from "@/lib/arcjet";
import { request } from "@arcjet/next";

// Ensure Gemini is initialized safely
const getGemini = () => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
};

// Convert Prisma Decimal → number
const serializeAmount = (obj) => ({
  ...obj,
  amount: obj.amount.toNumber(),
});

/* ------------------------------------
   CREATE TRANSACTION
-------------------------------------*/
export async function createTransaction(data) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const req = await request();
    await aj.protect(req, { userId, requested: 1 });

    const user = await db.user.findUnique({ where: { clerkUserId: userId } });
    if (!user) throw new Error("User not found");

    const account = await db.account.findUnique({
      where: { id: data.accountId, userId: user.id },
    });
    if (!account) throw new Error("Account not found");

    const balanceChange =
      data.type === "EXPENSE" ? -data.amount : data.amount;

    const newBalance = account.balance.toNumber() + balanceChange;

    const tx = await db.$transaction(async (trx) => {
      const newTx = await trx.transaction.create({
        data: {
          ...data,
          userId: user.id,
          nextRecurringDate:
            data.isRecurring && data.recurringInterval
              ? calculateNextRecurringDate(
                  data.date,
                  data.recurringInterval
                )
              : null,
        },
      });

      await trx.account.update({
        where: { id: data.accountId },
        data: { balance: newBalance },
      });

      return newTx;
    });

    revalidatePath("/dashboard");
    revalidatePath(`/account/${tx.accountId}`);

    return { success: true, data: serializeAmount(tx) };
  } catch (err) {
    console.error("createTransaction ERROR:", err);
    throw new Error(err.message);
  }
}

/* ------------------------------------
   GET TRANSACTION
-------------------------------------*/
export async function getTransaction(id) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({ where: { clerkUserId: userId } });
  if (!user) throw new Error("User not found");

  const tx = await db.transaction.findUnique({
    where: { id, userId: user.id },
  });
  if (!tx) throw new Error("Transaction not found");

  return serializeAmount(tx);
}

/* ------------------------------------
   UPDATE TRANSACTION
-------------------------------------*/
export async function updateTransaction(id, data) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });
    if (!user) throw new Error("User not found");

    const original = await db.transaction.findUnique({
      where: { id, userId: user.id },
      include: { account: true },
    });
    if (!original) throw new Error("Transaction not found");

    const oldChange =
      original.type === "EXPENSE"
        ? -original.amount.toNumber()
        : original.amount.toNumber();

    const newChange = data.type === "EXPENSE" ? -data.amount : data.amount;

    const net = newChange - oldChange;

    const tx = await db.$transaction(async (trx) => {
      const updated = await trx.transaction.update({
        where: { id, userId: user.id },
        data: {
          ...data,
          nextRecurringDate:
            data.isRecurring && data.recurringInterval
              ? calculateNextRecurringDate(
                  data.date,
                  data.recurringInterval
                )
              : null,
        },
      });

      await trx.account.update({
        where: { id: data.accountId },
        data: { balance: { increment: net } },
      });

      return updated;
    });

    revalidatePath("/dashboard");
    revalidatePath(`/account/${data.accountId}`);

    return { success: true, data: serializeAmount(tx) };
  } catch (err) {
    console.error("updateTransaction ERROR:", err);
    throw new Error(err.message);
  }
}

/* ------------------------------------
   GET USER TRANSACTIONS
-------------------------------------*/
export async function getUserTransactions(query = {}) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({ where: { clerkUserId: userId } });
    if (!user) throw new Error("User not found");

    const txs = await db.transaction.findMany({
      where: { userId: user.id, ...query },
      include: { account: true },
      orderBy: { date: "desc" },
    });

    return { success: true, data: txs };
  } catch (err) {
    console.error("getUserTransactions ERROR:", err);
    throw new Error(err.message);
  }
}

/* ------------------------------------
   SCAN RECEIPT (FINAL FIXED VERSION)
-------------------------------------*/
export async function scanReceipt(formData) {
  try {
    const file = formData.get("file");
    if (!file) throw new Error("No file uploaded");

    let BufferImpl = globalThis.Buffer;
    if (!BufferImpl) {
      const { Buffer } = await import("buffer");
      BufferImpl = Buffer;
    }

    const array = await file.arrayBuffer();
    const base64 = BufferImpl.from(array).toString("base64");

    const genAI = getGemini();
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
    });

    const prompt = `
      Extract structured JSON:

      {
        "amount": number,
        "date": "ISO",
        "description": "string",
        "merchantName": "string",
        "category": "string"
      }
    `;

    const out = await model.generateContent([
      {
        inlineData: {
          data: base64,
          mimeType: file.type ?? "image/jpeg",
        },
      },
      prompt,
    ]);

    const raw = out.response.text().trim();
    const clean = raw.replace(/```json|```/g, "").trim();

    let data;
    try {
      data = JSON.parse(clean);
    } catch (err) {
      console.error("JSON ERROR:", clean);
      throw new Error("Invalid AI output");
    }

    return {
      amount: isNaN(Number(data.amount)) ? 0 : Number(data.amount),
      date: data.date || new Date().toISOString(),
      description: data.description || "No Description",
      merchantName: data.merchantName || "Unknown",
      category: data.category || "Misc",
    };
  } catch (err) {
    console.error("scanReceipt ERROR:", err);
    throw new Error(err.message);
  }
}

/* ------------------------------------
   HELPER
-------------------------------------*/
function calculateNextRecurringDate(startDate, interval) {
  const d = new Date(startDate);
  switch (interval) {
    case "DAILY":
      d.setDate(d.getDate() + 1);
      break;
    case "WEEKLY":
      d.setDate(d.getDate() + 7);
      break;
    case "MONTHLY":
      d.setMonth(d.getMonth() + 1);
      break;
    case "YEARLY":
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d;
}
