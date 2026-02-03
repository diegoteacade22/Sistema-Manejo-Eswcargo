import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
    const { nextUrl } = req;
    const isLoggedIn = !!req.auth;

    // RUTA DE EMERGENCIA: Si entras a /login/admin-bypass, te deja pasar
    if (nextUrl.pathname === "/login/admin-bypass") {
        return NextResponse.next();
    }

    return NextResponse.next();
});

export const config = {
    matcher: ['/((?!api|_next/static|_next/image|.*\\.png$).*)'],
};
