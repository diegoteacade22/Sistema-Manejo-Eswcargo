import { AuthProvider } from "@/components/auth-provider";
import { auth } from "@/lib/auth";
import { Inter } from "next/font/google";
import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Sistema de Gestión",
  description: "Gestión de Importaciones y Cuentas Corrientes",
};

import { Toaster } from "sonner";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const isPublicRoute = !session; // Middleware handles redirection, but layout needs to know for UI

  return (
    <html lang="es" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
        <AuthProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <div className="h-full relative">
              {!isPublicRoute && (
                <div className="hidden h-full md:flex md:w-72 md:flex-col md:fixed md:inset-y-0 z-[80] bg-gray-900 print:hidden">
                  <Sidebar />
                </div>
              )}
              <main className={!isPublicRoute ? "md:pl-72 min-h-screen print:pl-0" : "min-h-screen"}>
                {children}
              </main>
            </div>
            <Toaster position="top-right" richColors />
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
