
import type { NextAuthConfig } from "next-auth"
import { NextResponse } from "next/server";

const ADMIN_ONLY_PREFIXES = [
    '/clients',
    '/suppliers',
    '/products',
    '/purchases',
    '/collections',
    '/expenses',
    '/maintenance',
    '/analytics',
    '/orders/new',
    '/shipments/new',
];

function isAdminOnlyPath(pathname: string) {
    return ADMIN_ONLY_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export const authConfig = {
    pages: {
        signIn: '/login',
    },
    trustHost: true,
    callbacks: {
        authorized({ auth, request: { nextUrl } }) {
            const isLoggedIn = !!auth?.user;
            const isPublicRoute =
                nextUrl.pathname.startsWith('/login') ||
                nextUrl.pathname.startsWith('/setup-account') ||
                nextUrl.pathname.startsWith('/api/auth') ||
                nextUrl.pathname.startsWith('/api/health');
            const role = (auth?.user as any)?.role;

            if (isPublicRoute) {
                // Permitimos el acceso a rutas públicas (login, setup-account) 
                // incluso si ya está logueado, por si quiere cambiar de cuenta.
                return true;
            }

            if (!isLoggedIn) {
                return false;
            }

            if (isAdminOnlyPath(nextUrl.pathname) && role !== 'ADMIN') {
                return NextResponse.redirect(new URL('/', nextUrl));
            }

            return true;
        },
        async jwt({ token, user }) {
            if (user) {
                token.role = (user as any).role;
                token.id = user.id;
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                (session.user as any).role = token.role;
                (session.user as any).id = token.id;
            }
            return session;
        },
    },
    providers: [], // Add providers with an empty array for now
} satisfies NextAuthConfig
