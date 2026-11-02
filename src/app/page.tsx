import { redirect } from 'next/navigation'

// El middleware manda al login si no hay sesión; con sesión se llega al dashboard.
export default function Home() {
  redirect('/dashboard')
}
