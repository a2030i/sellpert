// تم توليده آلياً من المخطط الحي (supabase gen types) — 2026-06-11
// لا تعدّل يدوياً؛ أعد التوليد بعد كل ترحيل.
// الاستخدام التدريجي: createClient<Database>(...) في lib/supabase.ts عند جاهزية الكود.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_transactions: {
        Row: {
          amount_description: string | null
          amount_type: string | null
          created_at: string | null
          credit: number | null
          currency: string | null
          debit: number | null
          deposit_date: string | null
          description: string | null
          id: string
          marketplace: string | null
          merchant_code: string
          net_amount: number | null
          order_id: string | null
          platform: string
          posted_date: string | null
          product_barcode: string | null
          product_name: string | null
          product_sku: string | null
          promotion_id: string | null
          quantity_purchased: number | null
          raw: Json | null
          settlement_id: string | null
          settlement_period_end: string | null
          settlement_period_start: string | null
          shipment_id: string | null
          transaction_date: string | null
          transaction_no: string | null
          transaction_type: string | null
          upload_id: string | null
        }
        Insert: {
          amount_description?: string | null
          amount_type?: string | null
          created_at?: string | null
          credit?: number | null
          currency?: string | null
          debit?: number | null
          deposit_date?: string | null
          description?: string | null
          id?: string
          marketplace?: string | null
          merchant_code: string
          net_amount?: number | null
          order_id?: string | null
          platform: string
          posted_date?: string | null
          product_barcode?: string | null
          product_name?: string | null
          product_sku?: string | null
          promotion_id?: string | null
          quantity_purchased?: number | null
          raw?: Json | null
          settlement_id?: string | null
          settlement_period_end?: string | null
          settlement_period_start?: string | null
          shipment_id?: string | null
          transaction_date?: string | null
          transaction_no?: string | null
          transaction_type?: string | null
          upload_id?: string | null
        }
        Update: {
          amount_description?: string | null
          amount_type?: string | null
          created_at?: string | null
          credit?: number | null
          currency?: string | null
          debit?: number | null
          deposit_date?: string | null
          description?: string | null
          id?: string
          marketplace?: string | null
          merchant_code?: string
          net_amount?: number | null
          order_id?: string | null
          platform?: string
          posted_date?: string | null
          product_barcode?: string | null
          product_name?: string | null
          product_sku?: string | null
          promotion_id?: string | null
          quantity_purchased?: number | null
          raw?: Json | null
          settlement_id?: string | null
          settlement_period_end?: string | null
          settlement_period_start?: string | null
          shipment_id?: string | null
          transaction_date?: string | null
          transaction_no?: string | null
          transaction_type?: string | null
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_transactions_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "account_transactions_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "account_transactions_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "platform_file_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_metrics: {
        Row: {
          acos: number | null
          ad_group_name: string | null
          ad_status: string | null
          add_to_cart: number | null
          asin: string | null
          budget_daily: number | null
          budget_remaining: number | null
          budget_total: number | null
          campaign_name: string | null
          clicks: number | null
          cpc: number | null
          cps: number | null
          created_at: string | null
          ctr: number | null
          currency: string | null
          cvr: number | null
          default_bid: number | null
          end_date: string | null
          id: string
          impressions: number | null
          keywords_count: number | null
          merchant_code: string
          orders: number | null
          platform: string
          products_count: number | null
          raw: Json | null
          report_date: string
          revenue: number | null
          roas: number | null
          search_query: string | null
          sku: string | null
          spend: number | null
          start_date: string | null
          suggested_bid_high: number | null
          suggested_bid_low: number | null
          suggested_bid_med: number | null
          upload_id: string | null
        }
        Insert: {
          acos?: number | null
          ad_group_name?: string | null
          ad_status?: string | null
          add_to_cart?: number | null
          asin?: string | null
          budget_daily?: number | null
          budget_remaining?: number | null
          budget_total?: number | null
          campaign_name?: string | null
          clicks?: number | null
          cpc?: number | null
          cps?: number | null
          created_at?: string | null
          ctr?: number | null
          currency?: string | null
          cvr?: number | null
          default_bid?: number | null
          end_date?: string | null
          id?: string
          impressions?: number | null
          keywords_count?: number | null
          merchant_code: string
          orders?: number | null
          platform: string
          products_count?: number | null
          raw?: Json | null
          report_date: string
          revenue?: number | null
          roas?: number | null
          search_query?: string | null
          sku?: string | null
          spend?: number | null
          start_date?: string | null
          suggested_bid_high?: number | null
          suggested_bid_low?: number | null
          suggested_bid_med?: number | null
          upload_id?: string | null
        }
        Update: {
          acos?: number | null
          ad_group_name?: string | null
          ad_status?: string | null
          add_to_cart?: number | null
          asin?: string | null
          budget_daily?: number | null
          budget_remaining?: number | null
          budget_total?: number | null
          campaign_name?: string | null
          clicks?: number | null
          cpc?: number | null
          cps?: number | null
          created_at?: string | null
          ctr?: number | null
          currency?: string | null
          cvr?: number | null
          default_bid?: number | null
          end_date?: string | null
          id?: string
          impressions?: number | null
          keywords_count?: number | null
          merchant_code?: string
          orders?: number | null
          platform?: string
          products_count?: number | null
          raw?: Json | null
          report_date?: string
          revenue?: number | null
          roas?: number | null
          search_query?: string | null
          sku?: string | null
          spend?: number | null
          start_date?: string | null
          suggested_bid_high?: number | null
          suggested_bid_low?: number | null
          suggested_bid_med?: number | null
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_metrics_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "ad_metrics_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "ad_metrics_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "platform_file_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_insights: {
        Row: {
          content: Json
          created_at: string
          id: string
          insight_type: string
          merchant_code: string
          model_used: string | null
        }
        Insert: {
          content: Json
          created_at?: string
          id?: string
          insight_type?: string
          merchant_code: string
          model_used?: string | null
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          insight_type?: string
          merchant_code?: string
          model_used?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          description: string | null
          is_secret: boolean | null
          key: string
          updated_at: string | null
          updated_by: string | null
          value: string | null
        }
        Insert: {
          description?: string | null
          is_secret?: boolean | null
          key: string
          updated_at?: string | null
          updated_by?: string | null
          value?: string | null
        }
        Update: {
          description?: string | null
          is_secret?: boolean | null
          key?: string
          updated_at?: string | null
          updated_by?: string | null
          value?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          id: string
          merchant_code: string | null
          new_values: Json | null
          old_values: Json | null
          performed_at: string | null
          performed_by: string | null
          record_id: string | null
          table_name: string | null
        }
        Insert: {
          action: string
          id?: string
          merchant_code?: string | null
          new_values?: Json | null
          old_values?: Json | null
          performed_at?: string | null
          performed_by?: string | null
          record_id?: string | null
          table_name?: string | null
        }
        Update: {
          action?: string
          id?: string
          merchant_code?: string | null
          new_values?: Json | null
          old_values?: Json | null
          performed_at?: string | null
          performed_by?: string | null
          record_id?: string | null
          table_name?: string | null
        }
        Relationships: []
      }
      budget_alerts: {
        Row: {
          alert_at_pct: number | null
          created_at: string | null
          id: string
          is_active: boolean | null
          last_alerted_at: string | null
          merchant_code: string
          monthly_limit: number
          notes: string | null
          platform: string | null
          updated_at: string | null
        }
        Insert: {
          alert_at_pct?: number | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_alerted_at?: string | null
          merchant_code: string
          monthly_limit: number
          notes?: string | null
          platform?: string | null
          updated_at?: string | null
        }
        Update: {
          alert_at_pct?: number | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_alerted_at?: string | null
          merchant_code?: string
          monthly_limit?: number
          notes?: string | null
          platform?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_alerts_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "budget_alerts_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      entry_sessions: {
        Row: {
          ad_spend: number | null
          created_at: string | null
          data_date: string
          entered_by: string
          id: string
          merchant_code: string
          platform: string
          platform_fees: number | null
          record_count: number | null
          total_sales: number | null
        }
        Insert: {
          ad_spend?: number | null
          created_at?: string | null
          data_date: string
          entered_by: string
          id?: string
          merchant_code: string
          platform: string
          platform_fees?: number | null
          record_count?: number | null
          total_sales?: number | null
        }
        Update: {
          ad_spend?: number | null
          created_at?: string | null
          data_date?: string
          entered_by?: string
          id?: string
          merchant_code?: string
          platform?: string
          platform_fees?: number | null
          record_count?: number | null
          total_sales?: number | null
        }
        Relationships: []
      }
      goods_received: {
        Row: {
          asn_number: string | null
          barcode: string | null
          created_at: string | null
          grn_date: string | null
          grn_quantity: number | null
          id: string
          merchant_code: string
          partner_sku: string | null
          platform: string
          qc_status: string | null
          raw: Json | null
          reject_reason: string | null
          sku: string | null
          upload_id: string | null
          warehouse_code: string | null
        }
        Insert: {
          asn_number?: string | null
          barcode?: string | null
          created_at?: string | null
          grn_date?: string | null
          grn_quantity?: number | null
          id?: string
          merchant_code: string
          partner_sku?: string | null
          platform: string
          qc_status?: string | null
          raw?: Json | null
          reject_reason?: string | null
          sku?: string | null
          upload_id?: string | null
          warehouse_code?: string | null
        }
        Update: {
          asn_number?: string | null
          barcode?: string | null
          created_at?: string | null
          grn_date?: string | null
          grn_quantity?: number | null
          id?: string
          merchant_code?: string
          partner_sku?: string | null
          platform?: string
          qc_status?: string | null
          raw?: Json | null
          reject_reason?: string | null
          sku?: string | null
          upload_id?: string | null
          warehouse_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goods_received_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "goods_received_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "goods_received_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "platform_file_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_shipment_items: {
        Row: {
          barcode: string | null
          brand_code: string | null
          category_code: string | null
          created_at: string | null
          cubic_feet: number | null
          id: string
          merchant_code: string
          partner_sku: string | null
          platform: string
          qty: number | null
          shipment_id: string
          sku: string | null
          storage_type: string | null
          upload_id: string | null
        }
        Insert: {
          barcode?: string | null
          brand_code?: string | null
          category_code?: string | null
          created_at?: string | null
          cubic_feet?: number | null
          id?: string
          merchant_code: string
          partner_sku?: string | null
          platform: string
          qty?: number | null
          shipment_id: string
          sku?: string | null
          storage_type?: string | null
          upload_id?: string | null
        }
        Update: {
          barcode?: string | null
          brand_code?: string | null
          category_code?: string | null
          created_at?: string | null
          cubic_feet?: number | null
          id?: string
          merchant_code?: string
          partner_sku?: string | null
          platform?: string
          qty?: number | null
          shipment_id?: string
          sku?: string | null
          storage_type?: string | null
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_shipment_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "inbound_shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_shipment_items_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "platform_file_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_shipments: {
        Row: {
          asn_number: string
          created_at: string | null
          delivered_qty: number | null
          delivery_date: string | null
          expected_qty: number | null
          id: string
          merchant_code: string
          platform: string
          raw: Json | null
          status: string | null
          upload_id: string | null
          variance: number | null
          warehouse_code: string | null
        }
        Insert: {
          asn_number: string
          created_at?: string | null
          delivered_qty?: number | null
          delivery_date?: string | null
          expected_qty?: number | null
          id?: string
          merchant_code: string
          platform: string
          raw?: Json | null
          status?: string | null
          upload_id?: string | null
          variance?: number | null
          warehouse_code?: string | null
        }
        Update: {
          asn_number?: string
          created_at?: string | null
          delivered_qty?: number | null
          delivery_date?: string | null
          expected_qty?: number | null
          id?: string
          merchant_code?: string
          platform?: string
          raw?: Json | null
          status?: string | null
          upload_id?: string | null
          variance?: number | null
          warehouse_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_shipments_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "inbound_shipments_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "inbound_shipments_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "platform_file_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory: {
        Row: {
          asin: string | null
          condition_type: string | null
          cost_price: number | null
          created_at: string
          fulfillment_channel: string | null
          id: string
          image_url: string | null
          is_active: boolean
          last_updated: string
          low_stock_threshold: number
          merchant_code: string
          partner_sku: string | null
          platform: string
          product_name: string | null
          quantity: number
          reserved_quantity: number
          sku: string
          stock_xdock_gross: number | null
          stock_xdock_net: number | null
          upload_id: string | null
        }
        Insert: {
          asin?: string | null
          condition_type?: string | null
          cost_price?: number | null
          created_at?: string
          fulfillment_channel?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          last_updated?: string
          low_stock_threshold?: number
          merchant_code: string
          partner_sku?: string | null
          platform: string
          product_name?: string | null
          quantity?: number
          reserved_quantity?: number
          sku: string
          stock_xdock_gross?: number | null
          stock_xdock_net?: number | null
          upload_id?: string | null
        }
        Update: {
          asin?: string | null
          condition_type?: string | null
          cost_price?: number | null
          created_at?: string
          fulfillment_channel?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          last_updated?: string
          low_stock_threshold?: number
          merchant_code?: string
          partner_sku?: string | null
          platform?: string
          product_name?: string | null
          quantity?: number
          reserved_quantity?: number
          sku?: string
          stock_xdock_gross?: number | null
          stock_xdock_net?: number | null
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "platform_file_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          created_at: string | null
          due_date: string | null
          id: string
          invoice_number: string | null
          merchant_code: string
          notes: string | null
          paid_at: string | null
          payment_ref: string | null
          period_end: string | null
          period_start: string | null
          status: string
          subscription_id: string | null
          tax_amount: number
          total_amount: number
          type: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          merchant_code: string
          notes?: string | null
          paid_at?: string | null
          payment_ref?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          subscription_id?: string | null
          tax_amount?: number
          total_amount: number
          type?: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          merchant_code?: string
          notes?: string | null
          paid_at?: string | null
          payment_ref?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          subscription_id?: string | null
          tax_amount?: number
          total_amount?: number
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "invoices_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_account_links: {
        Row: {
          created_at: string | null
          email: string
          id: string
          is_default: boolean | null
          merchant_code: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          is_default?: boolean | null
          merchant_code: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          is_default?: boolean | null
          merchant_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_account_links_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "merchant_account_links_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      merchant_notes: {
        Row: {
          author_email: string | null
          author_name: string | null
          body: string
          created_at: string | null
          id: string
          merchant_code: string
          pinned: boolean | null
          type: string | null
        }
        Insert: {
          author_email?: string | null
          author_name?: string | null
          body: string
          created_at?: string | null
          id?: string
          merchant_code: string
          pinned?: boolean | null
          type?: string | null
        }
        Update: {
          author_email?: string | null
          author_name?: string | null
          body?: string
          created_at?: string | null
          id?: string
          merchant_code?: string
          pinned?: boolean | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "merchant_notes_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "merchant_notes_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      merchant_platform_mappings: {
        Row: {
          connection_id: string
          created_at: string
          id: string
          is_active: boolean
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          merchant_code: string
          platform: string
          records_synced: number | null
          seller_id: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          merchant_code: string
          platform: string
          records_synced?: number | null
          seller_id: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          merchant_code?: string
          platform?: string
          records_synced?: number | null
          seller_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_platform_mappings_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "platform_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_requests: {
        Row: {
          admin_note: string | null
          assigned_to: string | null
          category: string | null
          created_at: string | null
          created_by: string | null
          created_by_role: string | null
          details: Json
          due_date: string | null
          id: string
          merchant_code: string
          note: string | null
          platform: string | null
          priority: string | null
          product_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          tags: string[] | null
          title: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          admin_note?: string | null
          assigned_to?: string | null
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          created_by_role?: string | null
          details?: Json
          due_date?: string | null
          id?: string
          merchant_code: string
          note?: string | null
          platform?: string | null
          priority?: string | null
          product_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          tags?: string[] | null
          title?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          admin_note?: string | null
          assigned_to?: string | null
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          created_by_role?: string | null
          details?: Json
          due_date?: string | null
          id?: string
          merchant_code?: string
          note?: string | null
          platform?: string | null
          priority?: string | null
          product_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          tags?: string[] | null
          title?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "merchant_requests_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "merchant_requests_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "merchant_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "buybox_warnings"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "merchant_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_abc_analysis"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "merchant_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_profitability"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "merchant_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_lifecycle"
            referencedColumns: ["id"]
          },
        ]
      }
      merchants: {
        Row: {
          created_at: string | null
          currency: string | null
          department: string | null
          email: string
          fixed_fee_per_order: number | null
          id: string
          is_active: boolean | null
          job_title: string | null
          logo_url: string | null
          merchant_code: string
          name: string
          onboarding_done: boolean
          owner_merchant_code: string | null
          permissions: Json | null
          role: string | null
          salla_store_id: string | null
          sector: string | null
          sellpert_commission_rate: number | null
          signup_source: string
          sub_sector: string | null
          subscription_monthly_amount: number | null
          subscription_plan: string | null
          subscription_status: string
          whatsapp_phone: string | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          department?: string | null
          email: string
          fixed_fee_per_order?: number | null
          id?: string
          is_active?: boolean | null
          job_title?: string | null
          logo_url?: string | null
          merchant_code: string
          name: string
          onboarding_done?: boolean
          owner_merchant_code?: string | null
          permissions?: Json | null
          role?: string | null
          salla_store_id?: string | null
          sector?: string | null
          sellpert_commission_rate?: number | null
          signup_source?: string
          sub_sector?: string | null
          subscription_monthly_amount?: number | null
          subscription_plan?: string | null
          subscription_status?: string
          whatsapp_phone?: string | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          department?: string | null
          email?: string
          fixed_fee_per_order?: number | null
          id?: string
          is_active?: boolean | null
          job_title?: string | null
          logo_url?: string | null
          merchant_code?: string
          name?: string
          onboarding_done?: boolean
          owner_merchant_code?: string | null
          permissions?: Json | null
          role?: string | null
          salla_store_id?: string | null
          sector?: string | null
          sellpert_commission_rate?: number | null
          signup_source?: string
          sub_sector?: string | null
          subscription_monthly_amount?: number | null
          subscription_plan?: string | null
          subscription_status?: string
          whatsapp_phone?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          action_path: string | null
          body: string | null
          created_at: string | null
          id: string
          is_read: boolean | null
          merchant_code: string | null
          title: string
          type: string
        }
        Insert: {
          action_path?: string | null
          body?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          merchant_code?: string | null
          title: string
          type?: string
        }
        Update: {
          action_path?: string | null
          body?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          merchant_code?: string | null
          title?: string
          type?: string
        }
        Relationships: []
      }
      nps_responses: {
        Row: {
          category: string | null
          feedback: string | null
          id: string
          merchant_code: string | null
          responded_at: string | null
          score: number | null
        }
        Insert: {
          category?: string | null
          feedback?: string | null
          id?: string
          merchant_code?: string | null
          responded_at?: string | null
          score?: number | null
        }
        Update: {
          category?: string | null
          feedback?: string | null
          id?: string
          merchant_code?: string | null
          responded_at?: string | null
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nps_responses_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "nps_responses_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      orders: {
        Row: {
          brand: string | null
          created_at: string
          currency: string
          customer_city: string | null
          delivered_date: string | null
          discount_amount: number | null
          family: string | null
          fulfillment_model: string | null
          gross_amount: number | null
          id: string
          merchant_code: string
          noon_sku: string | null
          order_date: string
          order_id: string
          partner_sku: string | null
          platform: string
          platform_fee: number | null
          product_name: string | null
          quantity: number
          shipment_date: string | null
          shipping_cost: number | null
          sku: string | null
          status: string
          total_amount: number
          unit_price: number
          upload_id: string | null
        }
        Insert: {
          brand?: string | null
          created_at?: string
          currency?: string
          customer_city?: string | null
          delivered_date?: string | null
          discount_amount?: number | null
          family?: string | null
          fulfillment_model?: string | null
          gross_amount?: number | null
          id?: string
          merchant_code: string
          noon_sku?: string | null
          order_date?: string
          order_id: string
          partner_sku?: string | null
          platform: string
          platform_fee?: number | null
          product_name?: string | null
          quantity?: number
          shipment_date?: string | null
          shipping_cost?: number | null
          sku?: string | null
          status?: string
          total_amount?: number
          unit_price?: number
          upload_id?: string | null
        }
        Update: {
          brand?: string | null
          created_at?: string
          currency?: string
          customer_city?: string | null
          delivered_date?: string | null
          discount_amount?: number | null
          family?: string | null
          fulfillment_model?: string | null
          gross_amount?: number | null
          id?: string
          merchant_code?: string
          noon_sku?: string | null
          order_date?: string
          order_id?: string
          partner_sku?: string | null
          platform?: string
          platform_fee?: number | null
          product_name?: string | null
          quantity?: number
          shipment_date?: string | null
          shipping_cost?: number | null
          sku?: string | null
          status?: string
          total_amount?: number
          unit_price?: number
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "platform_file_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_requests: {
        Row: {
          admin_note: string | null
          amount: number
          bank_reference: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string | null
          currency: string
          expires_at: string | null
          id: string
          merchant_code: string
          notes: string | null
          period_months: number
          plan: string
          rejected_at: string | null
          status: string
          total_amount: number | null
          transfer_date: string | null
          type: string
          updated_at: string | null
          vat_amount: number | null
        }
        Insert: {
          admin_note?: string | null
          amount: number
          bank_reference?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          currency?: string
          expires_at?: string | null
          id?: string
          merchant_code: string
          notes?: string | null
          period_months?: number
          plan: string
          rejected_at?: string | null
          status?: string
          total_amount?: number | null
          transfer_date?: string | null
          type?: string
          updated_at?: string | null
          vat_amount?: number | null
        }
        Update: {
          admin_note?: string | null
          amount?: number
          bank_reference?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          currency?: string
          expires_at?: string | null
          id?: string
          merchant_code?: string
          notes?: string | null
          period_months?: number
          plan?: string
          rejected_at?: string | null
          status?: string
          total_amount?: number | null
          transfer_date?: string | null
          type?: string
          updated_at?: string | null
          vat_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_requests_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "payment_requests_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      performance_data: {
        Row: {
          ad_spend: number | null
          created_at: string | null
          data_date: string | null
          edited_at: string | null
          edited_by: string | null
          entry_by: string | null
          id: string
          is_edited: boolean | null
          margin: number | null
          merchant_code: string
          notes: string | null
          order_count: number | null
          platform: string | null
          platform_fees: number | null
          product_id: string | null
          product_name: string | null
          total_sales: number | null
        }
        Insert: {
          ad_spend?: number | null
          created_at?: string | null
          data_date?: string | null
          edited_at?: string | null
          edited_by?: string | null
          entry_by?: string | null
          id?: string
          is_edited?: boolean | null
          margin?: number | null
          merchant_code: string
          notes?: string | null
          order_count?: number | null
          platform?: string | null
          platform_fees?: number | null
          product_id?: string | null
          product_name?: string | null
          total_sales?: number | null
        }
        Update: {
          ad_spend?: number | null
          created_at?: string | null
          data_date?: string | null
          edited_at?: string | null
          edited_by?: string | null
          entry_by?: string | null
          id?: string
          is_edited?: boolean | null
          margin?: number | null
          merchant_code?: string
          notes?: string | null
          order_count?: number | null
          platform?: string | null
          platform_fees?: number | null
          product_id?: string | null
          product_name?: string | null
          total_sales?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_data_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "performance_data_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "performance_data_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "buybox_warnings"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "performance_data_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_abc_analysis"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "performance_data_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_profitability"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "performance_data_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_data_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_lifecycle"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_commission_rates: {
        Row: {
          category: string
          id: string
          notes: string | null
          other_fees: number
          platform: string
          rate: number
          shipping_fee: number
          updated_at: string | null
          vat_rate: number
        }
        Insert: {
          category?: string
          id?: string
          notes?: string | null
          other_fees?: number
          platform: string
          rate?: number
          shipping_fee?: number
          updated_at?: string | null
          vat_rate?: number
        }
        Update: {
          category?: string
          id?: string
          notes?: string | null
          other_fees?: number
          platform?: string
          rate?: number
          shipping_fee?: number
          updated_at?: string | null
          vat_rate?: number
        }
        Relationships: []
      }
      platform_connections: {
        Row: {
          api_key: string | null
          api_secret: string | null
          created_at: string
          extra: Json | null
          id: string
          is_active: boolean
          label: string
          platform: string
          updated_at: string
        }
        Insert: {
          api_key?: string | null
          api_secret?: string | null
          created_at?: string
          extra?: Json | null
          id?: string
          is_active?: boolean
          label: string
          platform: string
          updated_at?: string
        }
        Update: {
          api_key?: string | null
          api_secret?: string | null
          created_at?: string
          extra?: Json | null
          id?: string
          is_active?: boolean
          label?: string
          platform?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_credentials: {
        Row: {
          api_key: string | null
          api_secret: string | null
          created_at: string | null
          extra: Json | null
          id: string
          is_active: boolean | null
          last_sync_at: string | null
          last_tested_at: string | null
          merchant_code: string
          platform: string
          records_synced: number | null
          seller_id: string | null
          test_status: string | null
          updated_at: string | null
        }
        Insert: {
          api_key?: string | null
          api_secret?: string | null
          created_at?: string | null
          extra?: Json | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          last_tested_at?: string | null
          merchant_code: string
          platform: string
          records_synced?: number | null
          seller_id?: string | null
          test_status?: string | null
          updated_at?: string | null
        }
        Update: {
          api_key?: string | null
          api_secret?: string | null
          created_at?: string | null
          extra?: Json | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          last_tested_at?: string | null
          merchant_code?: string
          platform?: string
          records_synced?: number | null
          seller_id?: string | null
          test_status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_credentials_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "platform_credentials_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      platform_deals: {
        Row: {
          applied_commission: number | null
          barcode: string | null
          brand: string | null
          category: string | null
          content_id: string | null
          created_at: string | null
          current_commission: number | null
          current_price: number | null
          current_stock: number | null
          end_date: string | null
          external_id: string | null
          id: string
          mega_deal_commission: number | null
          mega_deal_upper_price: number | null
          merchant_code: string
          model_code: string | null
          platform: string
          product_name: string | null
          raw: Json | null
          super_deal_commission: number | null
          super_deal_upper_price: number | null
          upload_id: string | null
        }
        Insert: {
          applied_commission?: number | null
          barcode?: string | null
          brand?: string | null
          category?: string | null
          content_id?: string | null
          created_at?: string | null
          current_commission?: number | null
          current_price?: number | null
          current_stock?: number | null
          end_date?: string | null
          external_id?: string | null
          id?: string
          mega_deal_commission?: number | null
          mega_deal_upper_price?: number | null
          merchant_code: string
          model_code?: string | null
          platform: string
          product_name?: string | null
          raw?: Json | null
          super_deal_commission?: number | null
          super_deal_upper_price?: number | null
          upload_id?: string | null
        }
        Update: {
          applied_commission?: number | null
          barcode?: string | null
          brand?: string | null
          category?: string | null
          content_id?: string | null
          created_at?: string | null
          current_commission?: number | null
          current_price?: number | null
          current_stock?: number | null
          end_date?: string | null
          external_id?: string | null
          id?: string
          mega_deal_commission?: number | null
          mega_deal_upper_price?: number | null
          merchant_code?: string
          model_code?: string | null
          platform?: string
          product_name?: string | null
          raw?: Json | null
          super_deal_commission?: number | null
          super_deal_upper_price?: number | null
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_deals_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "platform_deals_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "platform_deals_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "platform_file_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_fee_categories: {
        Row: {
          category_ar: string
          category_en: string
          category_key: string
          commission_fbn_fba: number | null
          commission_rate: number
          id: string
          min_fee_sar: number | null
          notes: string | null
          platform: string
          updated_at: string | null
        }
        Insert: {
          category_ar: string
          category_en: string
          category_key: string
          commission_fbn_fba?: number | null
          commission_rate?: number
          id?: string
          min_fee_sar?: number | null
          notes?: string | null
          platform: string
          updated_at?: string | null
        }
        Update: {
          category_ar?: string
          category_en?: string
          category_key?: string
          commission_fbn_fba?: number | null
          commission_rate?: number
          id?: string
          min_fee_sar?: number | null
          notes?: string | null
          platform?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      platform_file_uploads: {
        Row: {
          detected_report: string | null
          error_message: string | null
          file_name: string | null
          file_size: number | null
          file_type: string | null
          finished_at: string | null
          id: string
          merchant_code: string
          platform: string
          rows_inserted: number | null
          rows_processed: number | null
          rows_updated: number | null
          status: string | null
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          detected_report?: string | null
          error_message?: string | null
          file_name?: string | null
          file_size?: number | null
          file_type?: string | null
          finished_at?: string | null
          id?: string
          merchant_code: string
          platform: string
          rows_inserted?: number | null
          rows_processed?: number | null
          rows_updated?: number | null
          status?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          detected_report?: string | null
          error_message?: string | null
          file_name?: string | null
          file_size?: number | null
          file_type?: string | null
          finished_at?: string | null
          id?: string
          merchant_code?: string
          platform?: string
          rows_inserted?: number | null
          rows_processed?: number | null
          rows_updated?: number | null
          status?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_file_uploads_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "platform_file_uploads_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      platform_fulfillment_models: {
        Row: {
          id: string
          is_default: boolean | null
          model_key: string
          model_label: string
          notes: string | null
          platform: string
        }
        Insert: {
          id?: string
          is_default?: boolean | null
          model_key: string
          model_label: string
          notes?: string | null
          platform: string
        }
        Update: {
          id?: string
          is_default?: boolean | null
          model_key?: string
          model_label?: string
          notes?: string | null
          platform?: string
        }
        Relationships: []
      }
      platform_other_fees: {
        Row: {
          amount: number
          fee_label_ar: string
          fee_label_en: string | null
          fee_type: string
          id: string
          notes: string | null
          platform: string
          unit: string
          updated_at: string | null
        }
        Insert: {
          amount?: number
          fee_label_ar: string
          fee_label_en?: string | null
          fee_type: string
          id?: string
          notes?: string | null
          platform: string
          unit?: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          fee_label_ar?: string
          fee_label_en?: string | null
          fee_type?: string
          id?: string
          notes?: string | null
          platform?: string
          unit?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      platform_shipping_tiers: {
        Row: {
          asp_threshold: number | null
          extra_per_kg: number | null
          fee_above_asp: number
          fee_below_asp: number
          id: string
          model_key: string
          platform: string
          size_label_ar: string
          size_tier: string
          sort_order: number | null
          weight_max_kg: number | null
          weight_min_kg: number
        }
        Insert: {
          asp_threshold?: number | null
          extra_per_kg?: number | null
          fee_above_asp?: number
          fee_below_asp?: number
          id?: string
          model_key: string
          platform: string
          size_label_ar: string
          size_tier: string
          sort_order?: number | null
          weight_max_kg?: number | null
          weight_min_kg?: number
        }
        Update: {
          asp_threshold?: number | null
          extra_per_kg?: number | null
          fee_above_asp?: number
          fee_below_asp?: number
          id?: string
          model_key?: string
          platform?: string
          size_label_ar?: string
          size_tier?: string
          sort_order?: number | null
          weight_max_kg?: number | null
          weight_min_kg?: number
        }
        Relationships: []
      }
      price_change_log: {
        Row: {
          changed_by: string | null
          created_at: string | null
          id: string
          merchant_code: string
          new_price: number | null
          old_price: number | null
          platform: string | null
          product_id: string
          reason: string | null
        }
        Insert: {
          changed_by?: string | null
          created_at?: string | null
          id?: string
          merchant_code: string
          new_price?: number | null
          old_price?: number | null
          platform?: string | null
          product_id: string
          reason?: string | null
        }
        Update: {
          changed_by?: string | null
          created_at?: string | null
          id?: string
          merchant_code?: string
          new_price?: number | null
          old_price?: number | null
          platform?: string | null
          product_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_change_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "buybox_warnings"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "price_change_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_abc_analysis"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "price_change_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_profitability"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "price_change_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_change_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_lifecycle"
            referencedColumns: ["id"]
          },
        ]
      }
      product_performance_snapshots: {
        Row: {
          avg_price: number | null
          barcode: string | null
          brand: string | null
          cancel_rate: number | null
          cancel_reasons: Json | null
          cancelled: number | null
          category: string | null
          color: string | null
          created_at: string | null
          current_price: number | null
          current_stock: number | null
          discount: number | null
          gross_sales: number | null
          id: string
          merchant_code: string
          net_revenue: number | null
          net_sold: number | null
          platform: string
          product_name: string | null
          return_rate: number | null
          return_reasons: Json | null
          returned: number | null
          size: string | null
          sku: string | null
          snapshot_date: string
          sold: number | null
          total_orders: number | null
          upload_id: string | null
        }
        Insert: {
          avg_price?: number | null
          barcode?: string | null
          brand?: string | null
          cancel_rate?: number | null
          cancel_reasons?: Json | null
          cancelled?: number | null
          category?: string | null
          color?: string | null
          created_at?: string | null
          current_price?: number | null
          current_stock?: number | null
          discount?: number | null
          gross_sales?: number | null
          id?: string
          merchant_code: string
          net_revenue?: number | null
          net_sold?: number | null
          platform: string
          product_name?: string | null
          return_rate?: number | null
          return_reasons?: Json | null
          returned?: number | null
          size?: string | null
          sku?: string | null
          snapshot_date: string
          sold?: number | null
          total_orders?: number | null
          upload_id?: string | null
        }
        Update: {
          avg_price?: number | null
          barcode?: string | null
          brand?: string | null
          cancel_rate?: number | null
          cancel_reasons?: Json | null
          cancelled?: number | null
          category?: string | null
          color?: string | null
          created_at?: string | null
          current_price?: number | null
          current_stock?: number | null
          discount?: number | null
          gross_sales?: number | null
          id?: string
          merchant_code?: string
          net_revenue?: number | null
          net_sold?: number | null
          platform?: string
          product_name?: string | null
          return_rate?: number | null
          return_reasons?: Json | null
          returned?: number | null
          size?: string | null
          sku?: string | null
          snapshot_date?: string
          sold?: number | null
          total_orders?: number | null
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_performance_snapshots_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "product_performance_snapshots_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "product_performance_snapshots_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "platform_file_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      product_platform_listings: {
        Row: {
          bullet_points: Json | null
          description: string | null
          id: string
          images: Json | null
          keywords: Json | null
          merchant_code: string
          notes: string | null
          platform: string
          product_id: string
          title: string | null
          updated_at: string | null
        }
        Insert: {
          bullet_points?: Json | null
          description?: string | null
          id?: string
          images?: Json | null
          keywords?: Json | null
          merchant_code: string
          notes?: string | null
          platform: string
          product_id: string
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          bullet_points?: Json | null
          description?: string | null
          id?: string
          images?: Json | null
          keywords?: Json | null
          merchant_code?: string
          notes?: string | null
          platform?: string
          product_id?: string
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_platform_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "buybox_warnings"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_platform_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_abc_analysis"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_platform_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_profitability"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_platform_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_platform_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_lifecycle"
            referencedColumns: ["id"]
          },
        ]
      }
      product_platform_prices: {
        Row: {
          commission_rate: number
          id: string
          is_active: boolean
          merchant_code: string
          notes: string | null
          override_price: number | null
          platform: string
          product_id: string
          selling_price: number
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          commission_rate?: number
          id?: string
          is_active?: boolean
          merchant_code: string
          notes?: string | null
          override_price?: number | null
          platform: string
          product_id: string
          selling_price?: number
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          commission_rate?: number
          id?: string
          is_active?: boolean
          merchant_code?: string
          notes?: string | null
          override_price?: number | null
          platform?: string
          product_id?: string
          selling_price?: number
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_platform_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "buybox_warnings"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_platform_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_abc_analysis"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_platform_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_profitability"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_platform_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_platform_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_lifecycle"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          asin: string | null
          barcode: string | null
          brand: string | null
          buybox_price: number | null
          category: string | null
          color: string | null
          commission_rate: number | null
          cost_price: number
          created_at: string | null
          description: string | null
          external_id: string | null
          external_url: string | null
          gender: string | null
          id: string
          image_url: string | null
          images: Json | null
          merchant_code: string
          model_code: string | null
          msrp: number | null
          name: string
          noon_price_max: number | null
          noon_price_min: number | null
          noon_sku_child: string | null
          psku_code: string | null
          sale_end_date: string | null
          sale_price: number | null
          sale_start_date: string | null
          seller_price_max: number | null
          seller_price_min: number | null
          size: string | null
          sku: string | null
          status: string
          supplier_sku: string | null
          target_net_price: number
          updated_at: string | null
          upload_id: string | null
          vat_rate: number | null
          warranty: string | null
        }
        Insert: {
          asin?: string | null
          barcode?: string | null
          brand?: string | null
          buybox_price?: number | null
          category?: string | null
          color?: string | null
          commission_rate?: number | null
          cost_price?: number
          created_at?: string | null
          description?: string | null
          external_id?: string | null
          external_url?: string | null
          gender?: string | null
          id?: string
          image_url?: string | null
          images?: Json | null
          merchant_code: string
          model_code?: string | null
          msrp?: number | null
          name: string
          noon_price_max?: number | null
          noon_price_min?: number | null
          noon_sku_child?: string | null
          psku_code?: string | null
          sale_end_date?: string | null
          sale_price?: number | null
          sale_start_date?: string | null
          seller_price_max?: number | null
          seller_price_min?: number | null
          size?: string | null
          sku?: string | null
          status?: string
          supplier_sku?: string | null
          target_net_price?: number
          updated_at?: string | null
          upload_id?: string | null
          vat_rate?: number | null
          warranty?: string | null
        }
        Update: {
          asin?: string | null
          barcode?: string | null
          brand?: string | null
          buybox_price?: number | null
          category?: string | null
          color?: string | null
          commission_rate?: number | null
          cost_price?: number
          created_at?: string | null
          description?: string | null
          external_id?: string | null
          external_url?: string | null
          gender?: string | null
          id?: string
          image_url?: string | null
          images?: Json | null
          merchant_code?: string
          model_code?: string | null
          msrp?: number | null
          name?: string
          noon_price_max?: number | null
          noon_price_min?: number | null
          noon_sku_child?: string | null
          psku_code?: string | null
          sale_end_date?: string | null
          sale_price?: number | null
          sale_start_date?: string | null
          seller_price_max?: number | null
          seller_price_min?: number | null
          size?: string | null
          sku?: string | null
          status?: string
          supplier_sku?: string | null
          target_net_price?: number
          updated_at?: string | null
          upload_id?: string | null
          vat_rate?: number | null
          warranty?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "products_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "products_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "platform_file_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      returns: {
        Row: {
          created_at: string | null
          id: string
          merchant_code: string
          order_id: string | null
          platform: string
          product_name: string | null
          quantity: number | null
          reason: string | null
          return_amount: number | null
          return_date: string | null
          sku: string | null
          status: string | null
          upload_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          merchant_code: string
          order_id?: string | null
          platform: string
          product_name?: string | null
          quantity?: number | null
          reason?: string | null
          return_amount?: number | null
          return_date?: string | null
          sku?: string | null
          status?: string | null
          upload_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          merchant_code?: string
          order_id?: string | null
          platform?: string
          product_name?: string | null
          quantity?: number | null
          reason?: string | null
          return_amount?: number | null
          return_date?: string | null
          sku?: string | null
          status?: string | null
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "returns_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "platform_file_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_targets: {
        Row: {
          id: string
          merchant_code: string
          month: number
          platform: string
          target_amount: number
          updated_at: string | null
          year: number
        }
        Insert: {
          id?: string
          merchant_code: string
          month: number
          platform?: string
          target_amount?: number
          updated_at?: string | null
          year: number
        }
        Update: {
          id?: string
          merchant_code?: string
          month?: number
          platform?: string
          target_amount?: number
          updated_at?: string | null
          year?: number
        }
        Relationships: []
      }
      salla_connections: {
        Row: {
          access_token: string
          created_at: string | null
          id: string
          installed_at: string | null
          last_sync_at: string | null
          merchant_code: string
          orders_synced: number | null
          products_synced: number | null
          refresh_token: string | null
          salla_merchant_id: string | null
          salla_store_id: string
          scope: string | null
          store_country: string | null
          store_currency: string | null
          store_domain: string | null
          store_logo: string | null
          store_name: string | null
          sync_status: string
          token_expires_at: string | null
          uninstalled_at: string | null
          updated_at: string | null
        }
        Insert: {
          access_token: string
          created_at?: string | null
          id?: string
          installed_at?: string | null
          last_sync_at?: string | null
          merchant_code: string
          orders_synced?: number | null
          products_synced?: number | null
          refresh_token?: string | null
          salla_merchant_id?: string | null
          salla_store_id: string
          scope?: string | null
          store_country?: string | null
          store_currency?: string | null
          store_domain?: string | null
          store_logo?: string | null
          store_name?: string | null
          sync_status?: string
          token_expires_at?: string | null
          uninstalled_at?: string | null
          updated_at?: string | null
        }
        Update: {
          access_token?: string
          created_at?: string | null
          id?: string
          installed_at?: string | null
          last_sync_at?: string | null
          merchant_code?: string
          orders_synced?: number | null
          products_synced?: number | null
          refresh_token?: string | null
          salla_merchant_id?: string | null
          salla_store_id?: string
          scope?: string | null
          store_country?: string | null
          store_currency?: string | null
          store_domain?: string | null
          store_logo?: string | null
          store_name?: string | null
          sync_status?: string
          token_expires_at?: string | null
          uninstalled_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salla_connections_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "salla_connections_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      subscriptions: {
        Row: {
          amount: number | null
          billing_cycle: string | null
          billing_source: string
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string | null
          currency: string | null
          current_period_end: string | null
          current_period_start: string | null
          grace_period_end: string | null
          id: string
          merchant_code: string
          next_billing_date: string | null
          payment_method: string | null
          payment_request_id: string | null
          plan: string
          salla_store_id: string | null
          salla_subscription_id: string | null
          status: string
          trial_ends_at: string | null
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          billing_cycle?: string | null
          billing_source?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string | null
          currency?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          grace_period_end?: string | null
          id?: string
          merchant_code: string
          next_billing_date?: string | null
          payment_method?: string | null
          payment_request_id?: string | null
          plan?: string
          salla_store_id?: string | null
          salla_subscription_id?: string | null
          status?: string
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          billing_cycle?: string | null
          billing_source?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string | null
          currency?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          grace_period_end?: string | null
          id?: string
          merchant_code?: string
          next_billing_date?: string | null
          payment_method?: string | null
          payment_request_id?: string | null
          plan?: string
          salla_store_id?: string | null
          salla_subscription_id?: string | null
          status?: string
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "subscriptions_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "subscriptions_payment_request_id_fkey"
            columns: ["payment_request_id"]
            isOneToOne: false
            referencedRelation: "payment_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_logs: {
        Row: {
          error_message: string | null
          finished_at: string | null
          id: string
          merchant_code: string
          platform: string
          records_synced: number | null
          started_at: string | null
          status: string | null
        }
        Insert: {
          error_message?: string | null
          finished_at?: string | null
          id?: string
          merchant_code: string
          platform: string
          records_synced?: number | null
          started_at?: string | null
          status?: string | null
        }
        Update: {
          error_message?: string | null
          finished_at?: string | null
          id?: string
          merchant_code?: string
          platform?: string
          records_synced?: number | null
          started_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      sync_queue: {
        Row: {
          attempts: number
          created_at: string | null
          error_detail: Json | null
          error_message: string | null
          finished_at: string | null
          id: number
          job_type: string
          max_attempts: number
          merchant_code: string
          next_retry_at: string | null
          payload: Json
          platform: string
          priority: number
          scheduled_at: string
          started_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string | null
          error_detail?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: number
          job_type: string
          max_attempts?: number
          merchant_code: string
          next_retry_at?: string | null
          payload?: Json
          platform: string
          priority?: number
          scheduled_at?: string
          started_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string | null
          error_detail?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: number
          job_type?: string
          max_attempts?: number
          merchant_code?: string
          next_retry_at?: string | null
          payload?: Json
          platform?: string
          priority?: number
          scheduled_at?: string
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      sync_requests: {
        Row: {
          created_at: string | null
          id: string
          merchant_code: string
          note: string | null
          platform: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          merchant_code: string
          note?: string | null
          platform: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          merchant_code?: string
          note?: string | null
          platform?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: []
      }
      task_comments: {
        Row: {
          author_code: string
          author_role: string | null
          body: string
          created_at: string | null
          id: string
          is_internal: boolean | null
          task_id: string
        }
        Insert: {
          author_code: string
          author_role?: string | null
          body: string
          created_at?: string | null
          id?: string
          is_internal?: boolean | null
          task_id: string
        }
        Update: {
          author_code?: string
          author_role?: string | null
          body?: string
          created_at?: string | null
          id?: string
          is_internal?: boolean | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "merchant_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          error: string | null
          event_type: string
          id: number
          merchant_code: string | null
          payload: Json | null
          processed_at: string | null
          received_at: string | null
          source: string
          status: string
          store_id: string | null
        }
        Insert: {
          error?: string | null
          event_type: string
          id?: number
          merchant_code?: string | null
          payload?: Json | null
          processed_at?: string | null
          received_at?: string | null
          source: string
          status?: string
          store_id?: string | null
        }
        Update: {
          error?: string | null
          event_type?: string
          id?: number
          merchant_code?: string | null
          payload?: Json | null
          processed_at?: string | null
          received_at?: string | null
          source?: string
          status?: string
          store_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      ad_net_summary: {
        Row: {
          fee_rate: number | null
          gross_roas: number | null
          merchant_code: string | null
          net_roas: number | null
          platform: string | null
          return_rate: number | null
          total_commission: number | null
          total_fba: number | null
          total_fees: number | null
          total_gross: number | null
          total_net: number | null
          total_returns: number | null
          total_spend: number | null
          total_vat: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_metrics_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "ad_metrics_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      brand_performance: {
        Row: {
          brand: string | null
          merchant_code: string | null
          net_revenue: number | null
          platform: string | null
          return_rate_pct: number | null
          revenue: number | null
          units_returned: number | null
          units_sold: number | null
        }
        Relationships: []
      }
      buybox_warnings: {
        Row: {
          barcode: string | null
          buybox_price: number | null
          buybox_status: string | null
          merchant_code: string | null
          my_price: number | null
          name: string | null
          overprice_pct: number | null
          product_id: string | null
          sku: string | null
        }
        Insert: {
          barcode?: string | null
          buybox_price?: number | null
          buybox_status?: never
          merchant_code?: string | null
          my_price?: number | null
          name?: string | null
          overprice_pct?: never
          product_id?: string | null
          sku?: string | null
        }
        Update: {
          barcode?: string | null
          buybox_price?: number | null
          buybox_status?: never
          merchant_code?: string | null
          my_price?: number | null
          name?: string | null
          overprice_pct?: never
          product_id?: string | null
          sku?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "products_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      cross_platform_product_perf: {
        Row: {
          by_platform: Json | null
          merchant_code: string | null
          platforms_count: number | null
          product_key: string | null
          product_name: string | null
          total_revenue: number | null
        }
        Relationships: []
      }
      fulfillment_performance: {
        Row: {
          avg_delivery_hours: number | null
          avg_order_value: number | null
          avg_ship_hours: number | null
          cancelled: number | null
          fees: number | null
          fulfillment_model: string | null
          merchant_code: string | null
          orders: number | null
          platform: string | null
          returned: number | null
          revenue: number | null
        }
        Relationships: []
      }
      inventory_ageing: {
        Row: {
          age_days: number | null
          ageing_class: string | null
          cost_price: number | null
          id: string | null
          last_sold: string | null
          merchant_code: string | null
          platform: string | null
          product_name: string | null
          quantity: number | null
          sku: string | null
          tied_capital: number | null
        }
        Relationships: []
      }
      inventory_health: {
        Row: {
          cost_price: number | null
          daily_velocity: number | null
          days_of_stock: number | null
          health_status: string | null
          id: string | null
          last_sold_at: string | null
          low_stock_threshold: number | null
          merchant_code: string | null
          platform: string | null
          product_name: string | null
          quantity: number | null
          selling_price: number | null
          sku: string | null
          sold_30d: number | null
          stock_value_cost: number | null
          stock_value_retail: number | null
        }
        Relationships: []
      }
      inventory_pipeline: {
        Row: {
          asn_number: string | null
          asn_sent_at: string | null
          days_to_receive: number | null
          delivered_qty: number | null
          delivery_date: string | null
          expected_qty: number | null
          grn_total: number | null
          lost_qty: number | null
          merchant_code: string | null
          orders_after_receive: number | null
          platform: string | null
          qc_failed_lines: number | null
          qc_failed_qty: number | null
          revenue_after_receive: number | null
          units_sold_after_receive: number | null
          warehouse_code: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_shipments_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "inbound_shipments_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      merchant_timeline: {
        Row: {
          author_email: string | null
          body: string | null
          created_at: string | null
          kind: string | null
          merchant_code: string | null
          ref_id: string | null
          sub_type: string | null
          title: string | null
        }
        Relationships: []
      }
      platform_fee_profile: {
        Row: {
          commission: number | null
          fba_fee: number | null
          fee_rate: number | null
          merchant_code: string | null
          platform: string | null
          principal_gross: number | null
          promotions: number | null
          refund_commission: number | null
          withheld_vat: number | null
        }
        Relationships: [
          {
            foreignKeyName: "account_transactions_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "account_transactions_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      platform_return_profile: {
        Row: {
          merchant_code: string | null
          platform: string | null
          return_rate: number | null
          total_returned: number | null
          total_sold: number | null
        }
        Relationships: []
      }
      product_abc_analysis: {
        Row: {
          abc_class: string | null
          brand: string | null
          cumulative_pct: number | null
          merchant_code: string | null
          net_profit: number | null
          product_id: string | null
          product_name: string | null
          rank: number | null
          revenue: number | null
          sku: string | null
          units_sold: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "products_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      product_profitability: {
        Row: {
          ad_spend: number | null
          brand: string | null
          category: string | null
          cost_price: number | null
          merchant_code: string | null
          net_profit: number | null
          platform_fees: number | null
          product_id: string | null
          product_name: string | null
          profit_margin_pct: number | null
          returns_amount: number | null
          returns_count: number | null
          revenue: number | null
          roas: number | null
          selling_price: number | null
          sku: string | null
          total_cost: number | null
          units_sold: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "products_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      search_query_insights: {
        Row: {
          clicks: number | null
          ctr: number | null
          cvr: number | null
          impressions: number | null
          merchant_code: string | null
          occurrences: number | null
          orders: number | null
          platform: string | null
          revenue: number | null
          roas: number | null
          search_query: string | null
          spend: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_metrics_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "ad_metrics_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      sku_lifecycle: {
        Row: {
          age_days: number | null
          created_at: string | null
          id: string | null
          lifecycle_stage: string | null
          margin: number | null
          merchant_code: string | null
          name: string | null
          revenue: number | null
          sku: string | null
          units_sold: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "products_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      supplier_quality_over_time: {
        Row: {
          failed_lines: number | null
          failed_qty: number | null
          failure_rate_pct: number | null
          merchant_code: string | null
          month: string | null
          platform: string | null
          total_lines: number | null
          total_qty: number | null
        }
        Relationships: [
          {
            foreignKeyName: "goods_received_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "goods_received_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      supply_chain_health: {
        Row: {
          loss_rate_pct: number | null
          merchant_code: string | null
          platform: string | null
          qc_failed_qty: number | null
          qc_failures: number | null
          shipments: number | null
          total_delivered: number | null
          total_expected: number | null
          total_variance: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_shipments_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "inbound_shipments_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      suspended_merchants: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          email: string | null
          merchant_code: string | null
          name: string | null
          salla_store_id: string | null
          store_name: string | null
          subscription_status: string | null
        }
        Relationships: []
      }
      sync_queue_stats: {
        Row: {
          avg_duration_sec: number | null
          job_count: number | null
          job_type: string | null
          latest_job: string | null
          platform: string | null
          status: string | null
        }
        Relationships: []
      }
      top_failing_skus: {
        Row: {
          barcode: string | null
          merchant_code: string | null
          partner_sku: string | null
          platform: string | null
          reasons: string[] | null
          reject_events: number | null
          sku: string | null
          total_rejected_qty: number | null
        }
        Relationships: [
          {
            foreignKeyName: "goods_received_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "goods_received_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      true_ad_effectiveness: {
        Row: {
          campaign_name: string | null
          commission: number | null
          est_fees: number | null
          est_returns: number | null
          fba_fee: number | null
          fee_rate: number | null
          gross_revenue: number | null
          gross_roas: number | null
          merchant_code: string | null
          net_revenue: number | null
          net_roas: number | null
          orders: number | null
          platform: string | null
          return_rate: number | null
          sku: string | null
          spend: number | null
          withheld_vat: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_metrics_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "ad_metrics_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
      variant_performance: {
        Row: {
          brand: string | null
          color: string | null
          merchant_code: string | null
          net_revenue: number | null
          platform: string | null
          return_rate_pct: number | null
          revenue: number | null
          size: string | null
          units_returned: number | null
          units_sold: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_performance_snapshots_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["merchant_code"]
          },
          {
            foreignKeyName: "product_performance_snapshots_merchant_code_fkey"
            columns: ["merchant_code"]
            isOneToOne: false
            referencedRelation: "suspended_merchants"
            referencedColumns: ["merchant_code"]
          },
        ]
      }
    }
    Functions: {
      auto_suspend_expired_subscriptions: { Args: never; Returns: undefined }
      bulk_notify: {
        Args: {
          p_action_path?: string
          p_body: string
          p_merchant_codes: string[]
          p_title: string
        }
        Returns: number
      }
      cash_flow_forecast: {
        Args: { p_merchant_code: string }
        Returns: {
          bucket: string
          count: number
          expected_in: number
          expected_out: number
          net: number
        }[]
      }
      check_budget_alerts: { Args: never; Returns: number }
      complete_queue_job: {
        Args: { err_msg?: string; job_id: number; success: boolean }
        Returns: undefined
      }
      confirm_manual_payment: {
        Args: { p_admin_code: string; p_note?: string; p_request_id: string }
        Returns: Json
      }
      delete_employee: { Args: { p_employee_code: string }; Returns: Json }
      delete_upload_cascade: { Args: { p_upload_id: string }; Returns: Json }
      delete_upload_with_data: { Args: { p_upload_id: string }; Returns: Json }
      derive_orders_from_account_tx: {
        Args: { p_merchant_code: string }
        Returns: number
      }
      derive_product_platform_prices: {
        Args: { p_merchant_code: string }
        Returns: number
      }
      derive_returns_from_account_tx: {
        Args: { p_merchant_code: string }
        Returns: number
      }
      derive_returns_from_snapshots: {
        Args: { p_merchant_code: string }
        Returns: number
      }
      enqueue_daily_salla_sync: { Args: never; Returns: undefined }
      generate_proactive_alerts: {
        Args: { p_merchant_code: string }
        Returns: number
      }
      get_db_health: { Args: never; Returns: Json }
      inventory_turnover: {
        Args: { p_days?: number; p_merchant_code: string }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      merchant_activation: { Args: { p_merchant_code: string }; Returns: Json }
      merchant_health_score: {
        Args: { p_merchant_code: string }
        Returns: Json
      }
      my_employees: {
        Args: never
        Returns: {
          created_at: string
          email: string
          id: string
          is_active: boolean
          job_title: string
          merchant_code: string
          name: string
          permissions: Json
          whatsapp_phone: string
        }[]
      }
      my_linked_merchants: {
        Args: never
        Returns: {
          is_default: boolean
          merchant_code: string
          name: string
          role: string
        }[]
      }
      my_owner_merchant: { Args: never; Returns: string }
      period_comparison: {
        Args: { p_days?: number; p_merchant_code: string }
        Returns: Json
      }
      pnl_statement: {
        Args: { p_merchant_code: string; p_month?: number; p_year?: number }
        Returns: Json
      }
      process_sync_queue: {
        Args: { batch_size?: number }
        Returns: {
          id: number
          job_type: string
          merchant_code: string
          payload: Json
          platform: string
        }[]
      }
      reactivate_merchant: {
        Args: { p_merchant_code: string; p_period_end?: string }
        Returns: undefined
      }
      rebuild_all_derived_data: {
        Args: { p_merchant_code: string }
        Returns: Json
      }
      rebuild_performance_data: {
        Args: { p_merchant_code: string }
        Returns: number
      }
      reject_payment_request: {
        Args: { p_admin_code: string; p_reason?: string; p_request_id: string }
        Returns: Json
      }
      request_plan_upgrade: {
        Args: {
          p_merchant_code: string
          p_new_plan: string
          p_period_months?: number
        }
        Returns: Json
      }
      restock_recommendations: {
        Args: { p_lead_time_days?: number; p_merchant_code: string }
        Returns: {
          current_qty: number
          daily_velocity: number
          days_of_stock: number
          platform: string
          product_name: string
          sku: string
          suggested_order_qty: number
          urgency: string
        }[]
      }
      return_reasons_breakdown: {
        Args: { p_merchant_code: string }
        Returns: {
          count: number
          percentage: number
          reason: string
        }[]
      }
      revenue_forecast: { Args: { p_merchant_code: string }; Returns: Json }
      sales_heatmap: {
        Args: { p_days?: number; p_merchant_code: string }
        Returns: {
          day_of_week: number
          hour_of_day: number
          orders: number
          sales: number
        }[]
      }
      shipping_analytics: { Args: { p_merchant_code: string }; Returns: Json }
      suspend_merchant: {
        Args: { p_merchant_code: string; p_reason?: string }
        Returns: undefined
      }
      tasks_summary: { Args: { p_assigned?: string }; Returns: Json }
      team_dashboard_kpis: { Args: never; Returns: Json }
      trigger_queue_worker: { Args: never; Returns: undefined }
      update_employee: {
        Args: {
          p_employee_code: string
          p_is_active?: boolean
          p_job_title?: string
          p_name?: string
          p_permissions?: Json
        }
        Returns: Json
      }
      weekly_digest: { Args: { p_merchant_code: string }; Returns: Json }
      wipe_merchant_data: { Args: { p_merchant_code: string }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

