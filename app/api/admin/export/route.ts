import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { supabaseService, type Shoe, type ShoeSize } from "@/lib/supabase";
import { isStale, staleAgeDays } from "@/lib/staleness";
import ExcelJS from "exceljs";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/export
 *
 * Admin-only endpoint that generates and downloads a .xlsx spreadsheet of all
 * shoes with per-size breakdowns. One row per (shoe, size) for easy
 * filtering/sorting in Excel.
 *
 * Columns: Title, Brand, Sales Status, Price (USD), Price (ETB), US Size,
 * Logistics Status, Quantity, Created, Age (days), Stale.
 */
export async function GET() {
  const { error: authErr } = await requireRole(["admin"]);
  if (authErr) return authErr;

  // Fetch all shoes with sizes (fresh server-side, bypasses RLS).
  const db = supabaseService();
  const { data, error: dbErr } = await db
    .from("shoes")
    .select("*, shoe_sizes(*)")
    .order("created_at", { ascending: false });

  if (dbErr) {
    return NextResponse.json(
      { error: "Failed to fetch shoes" },
      { status: 500 }
    );
  }

  const shoes = (data as Shoe[]) ?? [];
  const now = new Date();

  // Build the workbook.
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Berebaso Admin";
  workbook.created = now;

  const sheet = workbook.addWorksheet("Shoes");

  // Define columns.
  sheet.columns = [
    { header: "Title", key: "title", width: 40 },
    { header: "Brand", key: "brand", width: 15 },
    { header: "Sales Status", key: "sales_status", width: 14 },
    { header: "Price (USD)", key: "price_usd", width: 13 },
    { header: "Price (ETB)", key: "price_etb", width: 13 },
    { header: "US Size", key: "us_size", width: 10 },
    { header: "Logistics Status", key: "logistics_status", width: 18 },
    { header: "Quantity", key: "quantity", width: 10 },
    { header: "Created", key: "created_at", width: 12 },
    { header: "Age (days)", key: "age_days", width: 11 },
    { header: "Stale", key: "stale", width: 7 },
  ];

  // Style the header row.
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };

  // Populate rows — one per (shoe, size). Shoes with no sizes get a single row.
  for (const shoe of shoes) {
    const sizes: ShoeSize[] = shoe.shoe_sizes ?? [];
    const ageDays = staleAgeDays(shoe, now);
    const stale = isStale(shoe, now);
    const createdDate = new Date(shoe.created_at);

    if (sizes.length === 0) {
      // Shoe with no sizes — one row, size columns blank.
      sheet.addRow({
        title: shoe.title,
        brand: shoe.brand ?? "",
        sales_status: shoe.status,
        price_usd: shoe.price_usd ?? "",
        price_etb: shoe.price_etb ?? "",
        us_size: "",
        logistics_status: "",
        quantity: "",
        created_at: createdDate,
        age_days: ageDays,
        stale: stale ? "Yes" : "",
      });
    } else {
      for (const sz of sizes) {
        sheet.addRow({
          title: shoe.title,
          brand: shoe.brand ?? "",
          sales_status: shoe.status,
          price_usd: shoe.price_usd ?? "",
          price_etb: shoe.price_etb ?? "",
          us_size: sz.us_size,
          logistics_status: sz.logistics_status ?? "not started",
          quantity: sz.quantity ?? 1,
          created_at: createdDate,
          age_days: ageDays,
          stale: stale ? "Yes" : "",
        });
      }
    }
  }

  // Format the created_at column as dates.
  sheet.getColumn("created_at").numFmt = "yyyy-mm-dd";

  // Auto-filter on all columns so the admin can filter/sort immediately.
  if (sheet.rowCount > 1) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: sheet.rowCount, column: sheet.columns.length },
    };
  }

  // Generate the xlsx buffer.
  const buffer = await workbook.xlsx.writeBuffer();

  // Timestamp the filename.
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

  // NextResponse body typing is strict in this TS version — cast via unknown.
  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="sole-supply-shoes-${dateStr}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
