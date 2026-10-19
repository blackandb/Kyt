import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="login">
      <div className="login-card">
        <span className="label">404</span>
        <h1 className="headline" style={{ fontSize: 34 }}>
          <span className="g1">Not found.</span>
        </h1>
        <Link className="btn btn-ghost" href="/">Back to transfers</Link>
      </div>
    </main>
  );
}
