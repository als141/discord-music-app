// app/api/discord/userGuilds/route.ts

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import axios from 'axios';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized. Please log in again.' }, { status: 401 });
  }

  const accessToken = session.accessToken as string;

  try {
    const response = await axios.get('https://discord.com/api/users/@me/guilds', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return NextResponse.json(response.data);
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        return NextResponse.json({ error: `Server error: ${error.response.data.message}` }, { status: error.response.status });
      } else if (error.request) {
        return NextResponse.json({ error: 'No response from server. Please try again later.' }, { status: 503 });
      } else {
        return NextResponse.json({ error: `Request error: ${error.message}` }, { status: 500 });
      }
    }
    return NextResponse.json({ error: 'An unexpected error occurred. Please try again later.' }, { status: 500 });
  }
}