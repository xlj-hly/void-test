import { z } from 'zod';

export const nameSchema = z.strictObject({ name: z.string().trim().min(1).max(16) });
export const roomIdLength = 10;
export const roomIdSchema = z.string().length(roomIdLength).regex(/^[A-F0-9]+$/);
