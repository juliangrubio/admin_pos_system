import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Central de Depósitos',
  description: 'Administración central de stock, compras y remitos.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang='es-AR'>
      <body className='antialiased'>{children}</body>
    </html>
  )
}
