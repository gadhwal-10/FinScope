// transaction.js
export const runtime = "nodejs"; // ensure Node runtime (not Edge)

"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { GoogleGenerativeAI } from "@google/generative-ai";
import aj from "@/lib/arcjet";
import { request } from "@arcjet/next";

/**
 * Defensive: ensure GEMINI API key exists before creating client.
 * Create client lazily inside functions so we can early-fail with a clear message.
 */
const makeGenAI = () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is not set. Set process.env.GEMINI_API_KEY and restart the server."
    );
  }
  return new GoogleGenerativeAI(key);
};

const serializeAmount = (obj) => ({
  ...obj,
  amount: obj.amount.toNumber(),
});

// Create Transaction
export async function createTransaction(data) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const req = await request();

    const decision = await aj.protect(req, {
      userId,
      requested: 1,
    });

    if (decision.isDenied()) {
      if (decision.reason.isRateLimit && decision.reason.isRateLimit()) {
        const { remaining, reset } = decision.reason;
        console.error({
          code: "RATE_LIMIT_EXCEEDED",
          details: { remaining, resetInSeconds: reset },
        });
        throw new Error("Too many requests. Please try again later.");
      }

      throw new Error("Request blocked");
    }

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });

    if (!user) throw new Error("User not found");

    const account = await db.account.findUnique({
      where: {
        id: data.accountId,
        userId: user.id,
      },
    });

    if (!account) throw new Error("Account not found");

    const balanceChange = data.type === "EXPENSE" ? -data.amount : data.amount;
    const newBalance = account.balance.toNumber() + balanceChange;

    const transaction = await db.$transaction(async (tx) => {
      const newTransaction = await tx.transaction.create({
        data: {
          ...data,
          userId: user.id,
          nextRecurringDate:
            data.isRecurring && data.recurringInterval
              ? calculateNextRecurringDate(data.date, data.recurringInterval)
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
  } catch (error) {
    console.error("createTransaction error:", error);
    // keep the thrown message simple for client, but log full error server-side
    throw new Error(error?.message || "Failed to create transaction");
  }
}

export async function getTransaction(id) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });

    if (!user) throw new Error("User not found");

    const transaction = await db.transaction.findUnique({
      where: { id, userId: user.id },
    });

    if (!transaction) throw new Error("Transaction not found");

    return serializeAmount(transaction);
  } catch (error) {
    console.error("getTransaction error:", error);
    throw new Error(error?.message || "Failed to get transaction");
  }
}

export async function updateTransaction(id, data) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });

    if (!user) throw new Error("User not found");

    const originalTransaction = await db.transaction.findUnique({
      where: { id, userId: user.id },
      include: { account: true },
    });

    if (!originalTransaction) throw new Error("Transaction not found");

    const oldBalanceChange =
      originalTransaction.type === "EXPENSE"
        ? -originalTransaction.amount.toNumber()
        : originalTransaction.amount.toNumber();

    const newBalanceChange = data.type === "EXPENSE" ? -data.amount : data.amount;

    const netBalanceChange = newBalanceChange - oldBalanceChange;

    const transaction = await db.$transaction(async (tx) => {
      const updated = await tx.transaction.update({
        where: { id, userId: user.id },
        data: {
          ...data,
          nextRecurringDate:
            data.isRecurring && data.recurringInterval
              ? calculateNextRecurringDate(data.date, data.recurringInterval)
              : null,
        },
      });

      await tx.account.update({
        where: { id: data.accountId },
        data: {
          balance: { increment: netBalanceChange },
        },
      });

      return updated;
    });

    revalidatePath("/dashboard");
    revalidatePath(`/account/${data.accountId}`);

    return { success: true, data: serializeAmount(transaction) };
  } catch (error) {
    console.error("updateTransaction error:", error);
    throw new Error(error?.message || "Failed to update transaction");
  }
}

// Get User Transactions
export async function getUserTransactions(query = {}) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });

    if (!user) throw new Error("User not found");

    const transactions = await db.transaction.findMany({
      where: { userId: user.id, ...query },
      include: { account: true },
      orderBy: { date: "desc" },
    });

    return { success: true, data: transactions };
  } catch (error) {
    console.error("getUserTransactions error:", error);
    throw new Error(error?.message || "Failed to fetch user transactions");
  }
}

//
// ------------------------------
// FIXED & DEFENSIVE SCAN RECEIPT
// ------------------------------
// Accepts FormData (formData.get("file"))
//
export async function scanReceipt(formData) {
  try {
    // Validate FormData
    if (!formData || typeof formData.get !== "function") {
      throw new Error("scanReceipt expects FormData");
    }

    const file = formData.get("file");
    if (!file) {
      throw new Error("No file uploaded");
    }

    // Create Gemini client safely (throws clear error if key missing)
    let genAI;
    try {
      genAI = makeGenAI();
    } catch (err) {
      console.error("Gemini client initialization error:", err);
      throw new Error("Server misconfiguration: missing GEMINI_API_KEY");
    }

    // Ensure Buffer is available (Edge runtime could lack it)
    let NodeBuffer = globalThis?.Buffer;
    if (!NodeBuffer) {
      try {
        const { Buffer: ImportedBuffer } = await import("buffer");
        NodeBuffer = ImportedBuffer;
      } catch (bufErr) {
        console.error("Buffer import failed:", bufErr);
        throw new Error("Buffer is not available in this runtime");
      }
    }

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64String = NodeBuffer.from(arrayBuffer).toString("base64");

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      Analyze this receipt image and extract the following information in JSON format:
      - Total amount (just the number)
      - Date (ISO string)
      - Description
      - Merchant/store name
      - Suggested category
      
      Respond ONLY with JSON:
      {
        "amount": number,
        "date": "ISO date string",
        "description": "string",
        "merchantName": "string",
        "category": "string"
      }
    `;

    const result = await model.generateContent([
      {
        inlineData: {
          data: base64String,
          mimeType: file.type || "image/jpeg",
        },
      },
      prompt,
    ]);

    const response = await result.response;
    const text = response.text();

    const cleanedText = text.replace(/```(?:json)?\n?/g, "").trim();

    let data;
    try {
      data = JSON.parse(cleanedText);
    } catch (err) {
      console.error("Gemini JSON Parse Error. Raw response:", cleanedText, err);
      throw new Error("Invalid JSON response from Gemini");
    }

    return {
      amount: typeof data.amount === "number" ? data.amount : parseFloat(data.amount) || 0,
      date: data.date ? new Date(data.date) : new Date(),
      description: data.description || "No Description",
      category: data.category || "Misc",
      merchantName: data.merchantName || "Unknown",
    };
  } catch (error) {
    // log full error on server for debugging
    console.error("scanReceipt error:", error);
    // throw a concise error message to the client (digest still will appear in prod, but terminal has details)
    throw new Error(error?.message || "Failed to scan receipt");
  }
}

// Helper function to calculate next recurring date
function calculateNextRecurringDate(startDate, interval) {
  const date = new Date(startDate);

  switch (interval) {
    case "DAILY":
      date.setDate(date.getDate() + 1);
      break;
    case "WEEKLY":
      date.setDate(date.getDate() + 7);
      break;
    case "MONTHLY":
      date.setMonth(date.getMonth() + 1);
      break;
    case "YEARLY":
      date.setFullYear(date.getFullYear() + 1);
      break;
  }

  return date;
}
