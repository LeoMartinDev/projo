/** Placeholder rows of an admin table while it loads; `row` is the table's row class. */
export const SkeletonRows = ({ count, row = 'adm-tr' }: { count: number; row?: string }) => (
  <>
    {Array.from({ length: count }, (_, index) => (
      <div key={index} className={`${row} ${row}--skeleton`} aria-hidden="true">
        <span className="skeleton skeleton--line" />
      </div>
    ))}
  </>
)
