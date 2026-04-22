import type { Shoe } from "@/lib/supabase";

export function ShoeCard({ shoe, dim = false }: { shoe: Shoe; dim?: boolean }) {
  return (
    <div
      className={`rounded-lg border border-neutral-200 overflow-hidden bg-white ${
        dim ? "opacity-50" : ""
      }`}
    >
      <div className="aspect-square bg-neutral-100 relative">
        {shoe.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shoe.image_url}
            alt={shoe.title}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-400 text-sm">
            No image
          </div>
        )}
        {shoe.status === "upcoming" && (
          <span className="absolute top-2 left-2 text-[10px] uppercase tracking-wider bg-black text-white px-2 py-1 rounded">
            Upcoming
          </span>
        )}
        {shoe.status === "sold" && (
          <span className="absolute top-2 left-2 text-[10px] uppercase tracking-wider bg-neutral-700 text-white px-2 py-1 rounded">
            Sold
          </span>
        )}
      </div>
      <div className="p-3 space-y-1">
        {shoe.brand && (
          <div className="text-[11px] uppercase tracking-wider text-neutral-500">
            {shoe.brand}
          </div>
        )}
        <div className="text-sm font-medium line-clamp-2 min-h-[2.5rem]">
          {shoe.title}
        </div>
      </div>
    </div>
  );
}
