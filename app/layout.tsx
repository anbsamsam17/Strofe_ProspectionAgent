import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import { MotionProvider } from '@/components/providers/motion-provider'
import { TechParticles } from '@/components/ui/tech-particles'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Glan — Prospection BEGES',
  description: "Vos prospects bilan carbone, qualifiés pendant la nuit. Sourcing Sirene + ADEME, pipeline commercial multi-contacts.",
  // Indexation gérée par route — défaut bloquant pour les routes dashboard/auth,
  // override en index:true sur la landing publique (app/page.tsx).
  robots: { index: false, follow: false },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <MotionProvider>
            {/* Particules ambient flottantes — couche fixed inset-0 (tech vibe) */}
            <TechParticles />
            {children}
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
