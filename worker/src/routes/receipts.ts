import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Vars } from '../types';
import { requireAuth } from '../middleware/auth';
import { checkRateLimit, getClientIp } from '../lib/rateLimit';

export const receiptRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
receiptRoutes.use('*', requireAuth);

const scanRequestSchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.string().min(1)
});

const scanResultSchema = z.object({
  date: z.string().optional(),
  vehicleNo: z.string().optional(),
  fuelType: z.string().optional(),
  litres: z.number(),
  ratePerLitre: z.number(),
  amount: z.number(),
  vendor: z.string().optional()
});

const EXTRACTION_PROMPT = `You are reading a fuel-pump receipt (petrol/diesel/AdBlue) from an Indian filling station. Extract:
- date: the transaction date, as YYYY-MM-DD
- vehicleNo: the vehicle registration number printed on the receipt, or "" if not visible
- fuelType: one of "diesel", "petrol", "adblue", "other" — infer from the product line
- litres: the fuel volume in litres, as a number
- ratePerLitre: the price per litre in rupees, as a number
- amount: the total amount paid in rupees, as a number
- vendor: the fuel station or dealer name, or "" if not visible
Read the numbers carefully — they are the most important part. Respond with only the JSON object, no other text.`;

// A driver's camera photo of a fuel receipt goes straight to Gemini for
// structured extraction; the frontend shows the result for the driver to
// confirm (or correct) before it's added as a fuel/expense entry — this
// endpoint never writes anything itself.
receiptRoutes.post('/scan', async (c) => {
  const auth = c.get('auth');
  const clientIp = getClientIp(c.req.raw);

  // Rate limit: max 10 OCR scans per minute per user account, and max 20 per minute per IP
  const userLimit = await checkRateLimit(c.env.DB, auth.userId, { windowSeconds: 60, maxRequests: 10, keyPrefix: 'ocr_user' });
  const ipLimit = await checkRateLimit(c.env.DB, clientIp, { windowSeconds: 60, maxRequests: 20, keyPrefix: 'ocr_ip' });

  if (!userLimit.allowed || !ipLimit.allowed) {
    const resetIn = Math.max(userLimit.resetInSeconds, ipLimit.resetInSeconds);
    c.header('Retry-After', String(resetIn));
    return c.json(
      { error: { code: 'rate_limited', message: `Receipt scanning rate limit reached. Please wait ${resetIn} seconds before trying again.` } },
      429
    );
  }

  const body = await c.req.json().catch(() => null);
  const parsed = scanRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.message } }, 422);

  if (parsed.data.imageBase64.length > 12_000_000) {
    return c.json({ error: { code: 'payload_too_large', message: 'Photo is too large — try a smaller image' } }, 413);
  }

  let geminiRes: Response;
  try {
    geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${c.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: EXTRACTION_PROMPT },
                { inline_data: { mime_type: parsed.data.mimeType, data: parsed.data.imageBase64 } }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                date: { type: 'STRING' },
                vehicleNo: { type: 'STRING' },
                fuelType: { type: 'STRING' },
                litres: { type: 'NUMBER' },
                ratePerLitre: { type: 'NUMBER' },
                amount: { type: 'NUMBER' },
                vendor: { type: 'STRING' }
              },
              required: ['litres', 'ratePerLitre', 'amount']
            }
          }
        })
      }
    );
  } catch (err) {
    console.error('Gemini request failed', err);
    return c.json({ error: { code: 'scan_failed', message: 'Could not reach the scanner — try again or enter it manually' } }, 502);
  }

  if (!geminiRes.ok) {
    console.error('Gemini error', geminiRes.status, await geminiRes.text().catch(() => ''));
    return c.json({ error: { code: 'scan_failed', message: 'Could not read the receipt — try again or enter it manually' } }, 502);
  }

  const geminiBody = await geminiRes.json<{ candidates?: { content?: { parts?: { text?: string }[] } }[] }>().catch(() => null);
  const text = geminiBody?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    return c.json({ error: { code: 'scan_failed', message: 'Could not read the receipt — try again or enter it manually' } }, 502);
  }

  let extracted: unknown;
  try {
    extracted = JSON.parse(text);
  } catch {
    return c.json({ error: { code: 'scan_failed', message: 'Could not read the receipt — try again or enter it manually' } }, 502);
  }

  const result = scanResultSchema.safeParse(extracted);
  if (!result.success) {
    return c.json({ error: { code: 'scan_failed', message: 'Could not read the receipt clearly — try again or enter it manually' } }, 502);
  }

  return c.json(result.data);
});
