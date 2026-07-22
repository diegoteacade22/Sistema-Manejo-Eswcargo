import { AuthProvider } from "@/components/auth-provider";
import { auth } from "@/lib/auth";
import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { Sidebar } from "@/components/sidebar";
import { AiChatButton } from "@/components/ai-chat-button";
import { MobileNav } from "@/components/mobile-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "ESW Operaciones",
  description: "Gestión de Importaciones y Cuentas Corrientes",
  applicationName: "ESW Operaciones",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'ESW' },
  icons: { apple: '/logo_factura.jpg' },
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
    <html lang="es" className="dark" style={{ colorScheme: "dark" }} suppressHydrationWarning>
      <body className="font-sans" suppressHydrationWarning>
        <AuthProvider session={session}>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            forcedTheme="dark"
            enableSystem={false}
            disableTransitionOnChange
          >
            <div className="h-full relative">
              <script
                dangerouslySetInnerHTML={{
                  __html: "if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(() => {}); }",
                }}
              />
              {!isPublicRoute && (
                <div className="hidden h-full md:flex md:w-72 md:flex-col md:fixed md:inset-y-0 z-[80] bg-gray-900 print:hidden">
                  <Sidebar />
                </div>
              )}
              <main className={!isPublicRoute ? "min-h-screen pb-20 md:pl-72 md:pb-0 print:pl-0 print:pb-0" : "min-h-screen"}>
                {children}
              </main>
              {!isPublicRoute && <AiChatButton />}
              {!isPublicRoute && <MobileNav role={(session?.user as { role?: string } | undefined)?.role} />}
            </div>
            <Toaster position="top-right" richColors />
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
