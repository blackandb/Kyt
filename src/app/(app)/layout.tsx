import { currentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { signOut } from '@/app/actions';
import { NavLink } from '@/components/ui';
import { IconChat, IconFeed, IconFlag, IconLogout, IconSearch, IconSettings, IconShield, IconWallet } from '@/components/icons';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/check', label: 'Check', icon: <IconSearch /> },
  { href: '/transfers', label: 'Transfers', icon: <IconFeed /> },
  { href: '/assistant', label: 'Assistant', icon: <IconChat /> },
  { href: '/wallets', label: 'Wallets', icon: <IconWallet /> },
  { href: '/flags', label: 'Flags', icon: <IconFlag /> },
  { href: '/settings', label: 'Settings', icon: <IconSettings /> }
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <IconShield width={15} height={15} />
          </div>
          <div>
            <div className="brand-name">KYT Monitor</div>
            <div className="brand-sub">Private</div>
          </div>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.href} href={n.href} icon={n.icon}>
            {n.label}
          </NavLink>
        ))}
        <div className="sidebar-foot">
          <div className="owner">{user.label}</div>
          <form action={signOut}>
            <button className="btn btn-ghost btn-sm" type="submit" style={{ width: '100%' }}>
              <IconLogout /> Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="sheet">{children}</main>
      <nav className="mobile-nav">
        {NAV.map((n) => (
          <NavLink key={n.href} href={n.href} icon={n.icon}>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
