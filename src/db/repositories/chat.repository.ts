import { eq, desc } from 'drizzle-orm';
import { getDatabase } from '../client';
import { chatSessions, chatMessages, NewChatSession, NewChatMessage } from '../schema';
import { uuid } from '~/utils/uuid';

export async function createChatSession(
  data: Omit<NewChatSession, 'id' | 'createdAt' | 'updatedAt'>
) {
  const db = getDatabase();
  const now = Date.now();
  const id = uuid();
  await db.insert(chatSessions).values({ ...data, id, createdAt: now, updatedAt: now });
  return id;
}

export async function getChatSessions(limit = 50) {
  const db = getDatabase();
  return db.query.chatSessions.findMany({
    orderBy: [desc(chatSessions.updatedAt)],
    limit,
  });
}

export async function getChatSession(id: string) {
  const db = getDatabase();
  return db.query.chatSessions.findFirst({ where: eq(chatSessions.id, id) });
}

export async function updateChatSessionTitle(id: string, title: string) {
  const db = getDatabase();
  await db
    .update(chatSessions)
    .set({ title, updatedAt: Date.now() })
    .where(eq(chatSessions.id, id));
}

export async function addChatMessage(
  data: Omit<NewChatMessage, 'id' | 'createdAt'>
) {
  const db = getDatabase();
  const id = uuid();
  const now = Date.now();
  await db.insert(chatMessages).values({ ...data, id, createdAt: now });
  // Bump session updatedAt
  await db
    .update(chatSessions)
    .set({ updatedAt: now })
    .where(eq(chatSessions.id, data.sessionId));
  return id;
}

export async function getChatMessages(sessionId: string) {
  const db = getDatabase();
  return db.query.chatMessages.findMany({
    where: eq(chatMessages.sessionId, sessionId),
    orderBy: [desc(chatMessages.createdAt)],
  });
}

export async function deleteChatSession(id: string) {
  const db = getDatabase();
  // Messages cascade via ON DELETE CASCADE
  await db.delete(chatSessions).where(eq(chatSessions.id, id));
}
