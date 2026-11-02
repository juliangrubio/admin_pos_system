import Header from '@/components/Header'
import { ToastProvider } from '@/components/Toaster'
import { requireUser } from '@/lib/auth'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

  return (
    <ToastProvider>
      <Header user={{ name: user.name, username: user.username, role: user.role }} />
      <main>{children}</main>
    </ToastProvider>
  )
}
