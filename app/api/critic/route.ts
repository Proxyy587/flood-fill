import { createRateLimiter, handleCriticRequest } from '../../../src/ai/criticRoute';

const allow = createRateLimiter(6, 60_000);

export async function POST(request: Request) {
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const { status, body } = await handleCriticRequest(await request.text(), client, allow, {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL,
  });
  return Response.json(body, { status });
}
