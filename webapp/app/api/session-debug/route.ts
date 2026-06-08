import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const session = await auth();
        const role = (session?.user as any)?.role;

        if (!session?.user || role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        return NextResponse.json({
            session,
            user: session?.user,
            role,
            timestamp: new Date().toISOString()
        }, { status: 200 });
    } catch (error) {
        return NextResponse.json({
            error: 'Failed to get session',
            message: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
