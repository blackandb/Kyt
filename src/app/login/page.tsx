import { ObjectTile } from '@/components/object-tile';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="login">
      <div className="login-card">
        <div className="fade-up">
          <ObjectTile size="lg" />
        </div>
        <span className="label fade-up d1">Private access</span>
        <h1 className="headline fade-up d1" style={{ fontSize: 38 }}>
          <span className="g1">Know every sender.</span>
          <br />
          <span className="g2">Before you trust it.</span>
        </h1>
        <p className="muted fade-up d2" style={{ margin: 0 }}>
          Wallet monitoring and risk screening for incoming transfers.
        </p>
        <div className="fade-up d3" style={{ width: '100%' }}>
          {error ? (
            <div className="notice err" style={{ marginBottom: 10 }}>
              The sign-in link is invalid or expired. Request a new one.
            </div>
          ) : null}
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
