export const runtime = "nodejs"; // force Node.js runtime

"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { GoogleGenerativeAI } from "@google/generative-ai";
import aj from "@/lib/arcjet";
import { request } from "@arcjet/next";

// Generate AI client only if key exists
const createGemini = () => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY missing");
  }
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
};

// Fix Date serialization
const serializeAmount = (obj) => ({
  ...obj,
  amount: obj.amount.toNumber(),
});

/* -----------------------------
   CREATE TRANSACTION
------------------------------*/
export async function createTransaction(data) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const req = await request();
    const decision = await aj.protect(req, { userId, requested: 1 });

    if (decision.isDenied()) {
      throw new Error("Rate limit blocked");
    }

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });
    if (!user) throw new Error("User not found");

    const account = await db.account.findUnique({
      where: { id: data.accountId, userId: user.id },
    });
    if (!account) throw new Error("Account not found");

    const balanceChange =
      data.type === "EXPENSE" ? -data.amount : data.amount;

    const newBalance = account.balance.toNumber() + balanceChange;

    const transaction = await db.$transaction(async (tx) => {
      const newTransaction = await tx.transaction.create({
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

      await tx.account.update({
        where: { id: data.accountId },
        data: { balance: newBalance },
      });

      return newTransaction;
    });

    revalidatePath("/dashboard");
    revalidatePath(`/account/${transaction.accountId}`);

    return { success: true, data: serializeAmount(transaction) };
  } catch (err) {
    console.error("createTransaction ERROR:", err);
    throw new Error(err.message);
  }
}

/* -----------------------------
   GET TRANSACTION
------------------------------*/
export async function getTransaction(id) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });
  if (!user) throw new Error("User not found");

  const tx = await db.transaction.findUnique({
    where: { id, userId: user.id },
  });

  if (!tx) throw new Error("Transaction not found");

  return serializeAmount(tx);
}

/* -----------------------------
   UPDATE TRANSACTION
------------------------------*/
export async function updateTransaction(id, data) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });
    if (!user) throw new Error("User not found");

    const originalTx = await db.transaction.findUnique({
      where: { id, userId: user.id },
      include: { account: true },
    });
    if (!originalTx) throw new Error("Transaction not found");

    const oldDelta =
      originalTx.type === "EXPENSE"
        ? -originalTx.amount.toNumber()
        : originalTx.amount.toNumber();

    const newDelta = data.type === "EXPENSE" ? -data.amount : data.amount;

    const netDelta = newDelta - oldDelta;

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
        data: { balance: { increment: netDelta } },
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

/* -----------------------------
   GET USER TRANSACTIONS
------------------------------*/
export async function getUserTransactions(query = {}) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });
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

/* -----------------------------
   SCAN RECEIPT (FIXED)
------------------------------*/
export async function scanReceipt(formData) {
  try {
    if (!formData || typeof formData.get !== "function") {
      throw new Error("scanReceipt must receive FormData");
    }

    const file = formData.get("file");
    if (!file) throw new Error("No file received");

    let BufferImpl = globalThis.Buffer;
    if (!BufferImpl) {
      const { Buffer } = await import("buffer");
      BufferImpl = Buffer;
    }

    const arrayBuf = await file.arrayBuffer();
    const base64 = BufferImpl.from(arrayBuf).toString("base64");

    const genAI = createGemini();
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
    Extract JSON:
    {
      "amount": number,
      "date": "ISO string",
      "description": "string",
      "merchantName": "string",
      "category": "string"
    }
    `;

    const result = await model.generateContent([
      {
        inlineData: {
          data: base64,
          mimeType: file.type ?? "image/jpeg",
        },
      },
      prompt,
    ]);

    const raw = result.response.text().trim();
    const clean = raw.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (err) {
      console.error("JSON parse error:", clean);
      throw new Error("Invalid AI output");
    }

    // FIX: return only serializable types
    return {
      amount:
        typeof parsed.amount === "number"
          ? parsed.amount
          : parseFloat(parsed.amount) || 0,
      date: parsed.date ? String(parsed.date) : new Date().toISOString(),
      description: parsed.description || "No Description",
      merchantName: parsed.merchantName || "Unknown",
      category: parsed.category || "Misc",
    };
  } catch (err) {
    console.error("scanReceipt ERROR:", err);
    throw new Error(err.message);
  }
}

/* -----------------------------
   NEXT RECURRING DATE
------------------------------*/
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
