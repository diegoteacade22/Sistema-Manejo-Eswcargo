import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const session = await auth();

        return NextResponse.json({
            session,
            user: session?.user,
            role: (session?.user as any)?.role,
            timestamp: new Date().toISOString()
        }, { status: 200 });
    } catch (error) {
        return NextResponse.json({
            error: 'Failed to get session',
            message: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
