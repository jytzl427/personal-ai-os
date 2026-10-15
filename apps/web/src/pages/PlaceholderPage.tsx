export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <section className="page-placeholder panel">
      <h1>{title}</h1>
      <p>{description}</p>
    </section>
  );
}
