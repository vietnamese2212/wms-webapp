// FILE SINH TỰ ĐỘNG — `node scripts/gen-db-types.mjs` (từ information_schema STAGING). KHÔNG sửa tay.
// Sinh lúc 2026-10-09T13:52:02.390Z · 115 bảng/view · 188 hàm · 0 enum
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      ApiKey: {
        Row: {
          id: string
          name: string
          key_hash: string
          key_prefix: string | null
          scopes: string[]
          is_active: boolean
          last_used_at: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          key_enc: string | null
        }
        Insert: {
          id: string
          name: string
          key_hash: string
          key_prefix?: string | null
          scopes?: string[]
          is_active?: boolean
          last_used_at?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          key_enc?: string | null
        }
        Update: {
          id?: string
          name?: string
          key_hash?: string
          key_prefix?: string | null
          scopes?: string[]
          is_active?: boolean
          last_used_at?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          key_enc?: string | null
        }
        Relationships: []
      }
      Attendance: {
        Row: {
          id: string
          employee_id: string
          work_date: string
          kind: string
          ot_hours: number
          early_leave_hours: number
          note: string | null
          created_at: string
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          id: string
          employee_id: string
          work_date: string
          kind: string
          ot_hours?: number
          early_leave_hours?: number
          note?: string | null
          created_at?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          id?: string
          employee_id?: string
          work_date?: string
          kind?: string
          ot_hours?: number
          early_leave_hours?: number
          note?: string | null
          created_at?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: []
      }
      Customer: {
        Row: {
          id: string
          ship_to_code: string
          name: string
          channel: string | null
          warehouse_id: string | null
          is_active: boolean
          auto_created: boolean
          note: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
          ward_code: string | null
          region_code: string | null
          region_name: string | null
          sales_district: string | null
          sales_office: string | null
          address: string | null
          sold_to_code: string | null
          search_term: string | null
          load_mode: string
          load_mode_by_category: Json
          max_vehicle_tons: number | null
          dispatch_vehicles: Json
          dispatch_separate: boolean
          max_customers_per_trip: number | null
          geo_lat: number | null
          geo_lng: number | null
          geo_source: string | null
          geo_accuracy_m: number | null
          geo_address: string | null
          geo_at: string | null
          geo_by: string | null
          dispatch_transfer: boolean
          max_customers_by_category: Json
        }
        Insert: {
          id: string
          ship_to_code: string
          name: string
          channel?: string | null
          warehouse_id?: string | null
          is_active?: boolean
          auto_created?: boolean
          note?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          ward_code?: string | null
          region_code?: string | null
          region_name?: string | null
          sales_district?: string | null
          sales_office?: string | null
          address?: string | null
          sold_to_code?: string | null
          search_term?: string | null
          load_mode?: string
          load_mode_by_category?: Json
          max_vehicle_tons?: number | null
          dispatch_vehicles?: Json
          dispatch_separate?: boolean
          max_customers_per_trip?: number | null
          geo_lat?: number | null
          geo_lng?: number | null
          geo_source?: string | null
          geo_accuracy_m?: number | null
          geo_address?: string | null
          geo_at?: string | null
          geo_by?: string | null
          dispatch_transfer?: boolean
          max_customers_by_category?: Json
        }
        Update: {
          id?: string
          ship_to_code?: string
          name?: string
          channel?: string | null
          warehouse_id?: string | null
          is_active?: boolean
          auto_created?: boolean
          note?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          ward_code?: string | null
          region_code?: string | null
          region_name?: string | null
          sales_district?: string | null
          sales_office?: string | null
          address?: string | null
          sold_to_code?: string | null
          search_term?: string | null
          load_mode?: string
          load_mode_by_category?: Json
          max_vehicle_tons?: number | null
          dispatch_vehicles?: Json
          dispatch_separate?: boolean
          max_customers_per_trip?: number | null
          geo_lat?: number | null
          geo_lng?: number | null
          geo_source?: string | null
          geo_accuracy_m?: number | null
          geo_address?: string | null
          geo_at?: string | null
          geo_by?: string | null
          dispatch_transfer?: boolean
          max_customers_by_category?: Json
        }
        Relationships: []
      }
      DeliverySlot: {
        Row: {
          id: string
          template_id: string | null
          vehicle_type_id: string
          direction: string | null
          cargo_type: string
          date: string
          time_from: string
          time_to: string
          max_vehicles: number
          booked_count: number
          status: string
          created_at: string
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          id: string
          template_id?: string | null
          vehicle_type_id: string
          direction?: string | null
          cargo_type?: string
          date: string
          time_from: string
          time_to: string
          max_vehicles: number
          booked_count?: number
          status?: string
          created_at?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          id?: string
          template_id?: string | null
          vehicle_type_id?: string
          direction?: string | null
          cargo_type?: string
          date?: string
          time_from?: string
          time_to?: string
          max_vehicles?: number
          booked_count?: number
          status?: string
          created_at?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: []
      }
      Department: {
        Row: {
          id: string
          name: string
          code: string
          allowed_modules: string[]
          is_active: boolean
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
          requires_scheduling: boolean
          is_carrier: boolean
        }
        Insert: {
          id: string
          name: string
          code: string
          allowed_modules?: string[]
          is_active?: boolean
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          requires_scheduling?: boolean
          is_carrier?: boolean
        }
        Update: {
          id?: string
          name?: string
          code?: string
          allowed_modules?: string[]
          is_active?: boolean
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          requires_scheduling?: boolean
          is_carrier?: boolean
        }
        Relationships: []
      }
      Employee: {
        Row: {
          id: string
          warehouse_id: string | null
          employee_code: string | null
          name: string
          department: string | null
          phone: string | null
          email: string | null
          password: string
          is_active: boolean
          created_at: string
          updated_at: string
          department_id: string | null
          job_title_id: string | null
          allowed_categories: string[] | null
          warehouse_scope: string | null
          password_hash: string | null
          module_permissions: Json | null
          deleted_at: string | null
          ncc_id: string | null
          is_driver: boolean
          created_by: string | null
          updated_by: string | null
          manager_id: string | null
          is_superadmin: boolean
        }
        Insert: {
          id: string
          warehouse_id?: string | null
          employee_code?: string | null
          name: string
          department?: string | null
          phone?: string | null
          email?: string | null
          password: string
          is_active?: boolean
          created_at?: string
          updated_at: string
          department_id?: string | null
          job_title_id?: string | null
          allowed_categories?: string[] | null
          warehouse_scope?: string | null
          password_hash?: string | null
          module_permissions?: Json | null
          deleted_at?: string | null
          ncc_id?: string | null
          is_driver?: boolean
          created_by?: string | null
          updated_by?: string | null
          manager_id?: string | null
          is_superadmin?: boolean
        }
        Update: {
          id?: string
          warehouse_id?: string | null
          employee_code?: string | null
          name?: string
          department?: string | null
          phone?: string | null
          email?: string | null
          password?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
          department_id?: string | null
          job_title_id?: string | null
          allowed_categories?: string[] | null
          warehouse_scope?: string | null
          password_hash?: string | null
          module_permissions?: Json | null
          deleted_at?: string | null
          ncc_id?: string | null
          is_driver?: boolean
          created_by?: string | null
          updated_by?: string | null
          manager_id?: string | null
          is_superadmin?: boolean
        }
        Relationships: []
      }
      EmployeeSkill: {
        Row: {
          id: string
          employee_id: string
          skill_id: string
          priority: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          employee_id: string
          skill_id: string
          priority?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          employee_id?: string
          skill_id?: string
          priority?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      FillOrder: {
        Row: {
          id: string
          order_code: string
          warehouse_id: string
          target_date: string
          status: string
          created_by: string | null
          created_at: string
          updated_at: string
          auto_created: boolean
          warehouse_type: string | null
          assignee_id: string | null
          assignee_name: string | null
          assigned_by: string | null
          assigned_at: string | null
          closed_at: string | null
          closed_by: string | null
        }
        Insert: {
          id: string
          order_code: string
          warehouse_id: string
          target_date: string
          status?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
          auto_created?: boolean
          warehouse_type?: string | null
          assignee_id?: string | null
          assignee_name?: string | null
          assigned_by?: string | null
          assigned_at?: string | null
          closed_at?: string | null
          closed_by?: string | null
        }
        Update: {
          id?: string
          order_code?: string
          warehouse_id?: string
          target_date?: string
          status?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
          auto_created?: boolean
          warehouse_type?: string | null
          assignee_id?: string | null
          assignee_name?: string | null
          assigned_by?: string | null
          assigned_at?: string | null
          closed_at?: string | null
          closed_by?: string | null
        }
        Relationships: []
      }
      FillTask: {
        Row: {
          id: string
          warehouse_id: string
          target_date: string
          material_id: string
          material_code: string | null
          material_name: string | null
          entry_id: string | null
          pallet_code: string | null
          from_location_id: string | null
          from_location_code: string | null
          to_location_id: string
          to_location_code: string | null
          qty_base: number
          status: string
          assignee_id: string | null
          assignee_name: string | null
          assigned_by: string | null
          assigned_at: string | null
          done_by: string | null
          done_by_name: string | null
          done_at: string | null
          cancel_reason: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          fill_order_id: string
          required_date: string | null
          required_expiry: string | null
          required_pallets: number
          scanned_pallets: number
          qty_done_base: number
        }
        Insert: {
          id: string
          warehouse_id: string
          target_date: string
          material_id: string
          material_code?: string | null
          material_name?: string | null
          entry_id?: string | null
          pallet_code?: string | null
          from_location_id?: string | null
          from_location_code?: string | null
          to_location_id: string
          to_location_code?: string | null
          qty_base?: number
          status?: string
          assignee_id?: string | null
          assignee_name?: string | null
          assigned_by?: string | null
          assigned_at?: string | null
          done_by?: string | null
          done_by_name?: string | null
          done_at?: string | null
          cancel_reason?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          fill_order_id: string
          required_date?: string | null
          required_expiry?: string | null
          required_pallets?: number
          scanned_pallets?: number
          qty_done_base?: number
        }
        Update: {
          id?: string
          warehouse_id?: string
          target_date?: string
          material_id?: string
          material_code?: string | null
          material_name?: string | null
          entry_id?: string | null
          pallet_code?: string | null
          from_location_id?: string | null
          from_location_code?: string | null
          to_location_id?: string
          to_location_code?: string | null
          qty_base?: number
          status?: string
          assignee_id?: string | null
          assignee_name?: string | null
          assigned_by?: string | null
          assigned_at?: string | null
          done_by?: string | null
          done_by_name?: string | null
          done_at?: string | null
          cancel_reason?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          fill_order_id?: string
          required_date?: string | null
          required_expiry?: string | null
          required_pallets?: number
          scanned_pallets?: number
          qty_done_base?: number
        }
        Relationships: []
      }
      FillTaskScan: {
        Row: {
          id: string
          task_id: string
          fill_order_id: string | null
          entry_id: string
          pallet_code: string
          qty_base: number
          production_date: string | null
          from_location_code: string | null
          to_location_id: string | null
          to_location_code: string | null
          scanned_by: string | null
          scanned_by_name: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          task_id: string
          fill_order_id?: string | null
          entry_id: string
          pallet_code: string
          qty_base?: number
          production_date?: string | null
          from_location_code?: string | null
          to_location_id?: string | null
          to_location_code?: string | null
          scanned_by?: string | null
          scanned_by_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          task_id?: string
          fill_order_id?: string | null
          entry_id?: string
          pallet_code?: string
          qty_base?: number
          production_date?: string | null
          from_location_code?: string | null
          to_location_id?: string | null
          to_location_code?: string | null
          scanned_by?: string | null
          scanned_by_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      GroupDeliveryOrder: {
        Row: {
          id: string
          group_code: string
          planned_date: string
          delivery_date: string
          warehouse_id: string | null
          dvvt: string | null
          status: string
          created_at: string
          updated_at: string
          assigned_at: string | null
          assigned_by: string | null
          started_at: string | null
          license_plate: string | null
          container_number: string | null
          exporter_name: string | null
          loader_name: string | null
          forklift_driver_id: string | null
          warehouse_type: string | null
          completed_at: string | null
          last_scanned_at: string | null
          forklift_driver_names: string | null
          created_by: string | null
          updated_by: string | null
          gate_registration_id: string | null
          shipto_party: string | null
          scan_completed_at: string | null
          transfer_status: string | null
          priority: string | null
          transport_note: string | null
          weigh_waived_at: string | null
          weigh_waived_by: string | null
          weigh_waive_reason: string | null
          gate_waived_at: string | null
          gate_waived_by: string | null
          gate_waive_reason: string | null
          origin: string | null
          awaiting_sap: boolean
          awaiting_dos: string[] | null
          plan_dropped: boolean
          plan_dropped_at: string | null
          dock_location_id: string | null
          dock_assigned_at: string | null
          forklift_driver_ids: string[] | null
          vehicle_model_id: string | null
          freight_estimated: number | null
          freight_tariff_id: string | null
          freight_detail: Json | null
        }
        Insert: {
          id: string
          group_code: string
          planned_date: string
          delivery_date: string
          warehouse_id?: string | null
          dvvt?: string | null
          status?: string
          created_at?: string
          updated_at: string
          assigned_at?: string | null
          assigned_by?: string | null
          started_at?: string | null
          license_plate?: string | null
          container_number?: string | null
          exporter_name?: string | null
          loader_name?: string | null
          forklift_driver_id?: string | null
          warehouse_type?: string | null
          completed_at?: string | null
          last_scanned_at?: string | null
          forklift_driver_names?: string | null
          created_by?: string | null
          updated_by?: string | null
          gate_registration_id?: string | null
          shipto_party?: string | null
          scan_completed_at?: string | null
          transfer_status?: string | null
          priority?: string | null
          transport_note?: string | null
          weigh_waived_at?: string | null
          weigh_waived_by?: string | null
          weigh_waive_reason?: string | null
          gate_waived_at?: string | null
          gate_waived_by?: string | null
          gate_waive_reason?: string | null
          origin?: string | null
          awaiting_sap?: boolean
          awaiting_dos?: string[] | null
          plan_dropped?: boolean
          plan_dropped_at?: string | null
          dock_location_id?: string | null
          dock_assigned_at?: string | null
          forklift_driver_ids?: string[] | null
          vehicle_model_id?: string | null
          freight_estimated?: number | null
          freight_tariff_id?: string | null
          freight_detail?: Json | null
        }
        Update: {
          id?: string
          group_code?: string
          planned_date?: string
          delivery_date?: string
          warehouse_id?: string | null
          dvvt?: string | null
          status?: string
          created_at?: string
          updated_at?: string
          assigned_at?: string | null
          assigned_by?: string | null
          started_at?: string | null
          license_plate?: string | null
          container_number?: string | null
          exporter_name?: string | null
          loader_name?: string | null
          forklift_driver_id?: string | null
          warehouse_type?: string | null
          completed_at?: string | null
          last_scanned_at?: string | null
          forklift_driver_names?: string | null
          created_by?: string | null
          updated_by?: string | null
          gate_registration_id?: string | null
          shipto_party?: string | null
          scan_completed_at?: string | null
          transfer_status?: string | null
          priority?: string | null
          transport_note?: string | null
          weigh_waived_at?: string | null
          weigh_waived_by?: string | null
          weigh_waive_reason?: string | null
          gate_waived_at?: string | null
          gate_waived_by?: string | null
          gate_waive_reason?: string | null
          origin?: string | null
          awaiting_sap?: boolean
          awaiting_dos?: string[] | null
          plan_dropped?: boolean
          plan_dropped_at?: string | null
          dock_location_id?: string | null
          dock_assigned_at?: string | null
          forklift_driver_ids?: string[] | null
          vehicle_model_id?: string | null
          freight_estimated?: number | null
          freight_tariff_id?: string | null
          freight_detail?: Json | null
        }
        Relationships: []
      }
      ImportShift: {
        Row: {
          id: string
          code: string
          name: string
          display_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          code: string
          name: string
          display_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          code?: string
          name?: string
          display_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      InventoryAdjustmentLog: {
        Row: {
          id: string
          entry_id: string
          delta: number
          cartons_before: number
          cartons_after: number
          note: string | null
          actor_name: string | null
          actor_id: string | null
          adjusted_at: string
        }
        Insert: {
          id: string
          entry_id: string
          delta: number
          cartons_before: number
          cartons_after: number
          note?: string | null
          actor_name?: string | null
          actor_id?: string | null
          adjusted_at?: string
        }
        Update: {
          id?: string
          entry_id?: string
          delta?: number
          cartons_before?: number
          cartons_after?: number
          note?: string | null
          actor_name?: string | null
          actor_id?: string | null
          adjusted_at?: string
        }
        Relationships: []
      }
      InventoryEntry: {
        Row: {
          id: string
          pallet_code: string
          location_id: string | null
          material_id: string
          manufacturer_id: string | null
          cycle: string | null
          stack_layer: number
          cartons_imported: number
          production_date: string | null
          status: string
          notes: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          import_order_id: string | null
          machine_code: string | null
          updated_by: string | null
          pallet_sequence_no: number | null
          qa_status_id: string | null
          import_date: string | null
          update_date: string | null
          cartons_remaining: number | null
          adjustment_qty: number | null
          stocktake_by: string | null
          stocktake_at: string | null
          cartons_reserved: number
          stocktake_flagged: boolean | null
          stocktake_flag_note: string | null
          warehouse_id: string | null
          parent_pallet_code: string | null
          origin: string
          ncc_id: string | null
          shelf_life_days: number | null
          nmsx: string | null
          batch: string | null
          expiry_date: string | null
          putaway_checked: boolean
          putaway_violation: string | null
          putaway_override_reason: string | null
        }
        Insert: {
          id: string
          pallet_code: string
          location_id?: string | null
          material_id: string
          manufacturer_id?: string | null
          cycle?: string | null
          stack_layer?: number
          cartons_imported: number
          production_date?: string | null
          status?: string
          notes?: string | null
          created_at?: string
          updated_at: string
          created_by?: string | null
          import_order_id?: string | null
          machine_code?: string | null
          updated_by?: string | null
          pallet_sequence_no?: number | null
          qa_status_id?: string | null
          import_date?: string | null
          update_date?: string | null
          cartons_remaining?: number | null
          adjustment_qty?: number | null
          stocktake_by?: string | null
          stocktake_at?: string | null
          cartons_reserved?: number
          stocktake_flagged?: boolean | null
          stocktake_flag_note?: string | null
          warehouse_id?: string | null
          parent_pallet_code?: string | null
          origin?: string
          ncc_id?: string | null
          shelf_life_days?: number | null
          nmsx?: string | null
          batch?: string | null
          expiry_date?: string | null
          putaway_checked?: boolean
          putaway_violation?: string | null
          putaway_override_reason?: string | null
        }
        Update: {
          id?: string
          pallet_code?: string
          location_id?: string | null
          material_id?: string
          manufacturer_id?: string | null
          cycle?: string | null
          stack_layer?: number
          cartons_imported?: number
          production_date?: string | null
          status?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          import_order_id?: string | null
          machine_code?: string | null
          updated_by?: string | null
          pallet_sequence_no?: number | null
          qa_status_id?: string | null
          import_date?: string | null
          update_date?: string | null
          cartons_remaining?: number | null
          adjustment_qty?: number | null
          stocktake_by?: string | null
          stocktake_at?: string | null
          cartons_reserved?: number
          stocktake_flagged?: boolean | null
          stocktake_flag_note?: string | null
          warehouse_id?: string | null
          parent_pallet_code?: string | null
          origin?: string
          ncc_id?: string | null
          shelf_life_days?: number | null
          nmsx?: string | null
          batch?: string | null
          expiry_date?: string | null
          putaway_checked?: boolean
          putaway_violation?: string | null
          putaway_override_reason?: string | null
        }
        Relationships: []
      }
      JobTitle: {
        Row: {
          id: string
          name: string
          department_id: string | null
          is_active: boolean
          created_at: string
          updated_at: string
          module_permissions: Json | null
          created_by: string | null
          updated_by: string | null
          parent_id: string | null
          in_chart: boolean
          is_driver: boolean
          landing_page: string | null
          is_forklift_driver: boolean
        }
        Insert: {
          id: string
          name: string
          department_id?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          module_permissions?: Json | null
          created_by?: string | null
          updated_by?: string | null
          parent_id?: string | null
          in_chart?: boolean
          is_driver?: boolean
          landing_page?: string | null
          is_forklift_driver?: boolean
        }
        Update: {
          id?: string
          name?: string
          department_id?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          module_permissions?: Json | null
          created_by?: string | null
          updated_by?: string | null
          parent_id?: string | null
          in_chart?: boolean
          is_driver?: boolean
          landing_page?: string | null
          is_forklift_driver?: boolean
        }
        Relationships: []
      }
      LeaveRequest: {
        Row: {
          id: string
          employee_id: string
          date_from: string
          date_to: string
          leave_type: string
          reason: string | null
          status: string
          approved_by: string | null
          approved_at: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
          warehouse_id: string | null
        }
        Insert: {
          id: string
          employee_id: string
          date_from: string
          date_to: string
          leave_type?: string
          reason?: string | null
          status?: string
          approved_by?: string | null
          approved_at?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          warehouse_id?: string | null
        }
        Update: {
          id?: string
          employee_id?: string
          date_from?: string
          date_to?: string
          leave_type?: string
          reason?: string | null
          status?: string
          approved_by?: string | null
          approved_at?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          warehouse_id?: string | null
        }
        Relationships: []
      }
      Location: {
        Row: {
          id: string
          location_code: string
          row: string
          shelf: string
          max_pallets: number
          is_active: boolean
          created_at: string
          updated_at: string
          warehouse_id: string
          sub_code: string
          sub_name: string | null
          sub_type: string | null
          requires_stocktake: boolean | null
          created_by: string | null
          updated_by: string | null
          slot_no_in: boolean
          slot_no_out: boolean
          categories: string[] | null
          search_norm: string | null
          is_pick_face: boolean
          max_materials: number | null
          is_rack: boolean
          level_no: number | null
          grid_x: number | null
          grid_y: number | null
          kind: string
          grid_w: number
          grid_h: number
          dock_capacity: number | null
          serve_categories: string[] | null
          storage_condition: string | null
        }
        Insert: {
          id: string
          location_code: string
          row: string
          shelf: string
          max_pallets?: number
          is_active?: boolean
          created_at?: string
          updated_at: string
          warehouse_id: string
          sub_code: string
          sub_name?: string | null
          sub_type?: string | null
          requires_stocktake?: boolean | null
          created_by?: string | null
          updated_by?: string | null
          slot_no_in?: boolean
          slot_no_out?: boolean
          categories?: string[] | null
          search_norm?: string | null
          is_pick_face?: boolean
          max_materials?: number | null
          is_rack?: boolean
          level_no?: number | null
          grid_x?: number | null
          grid_y?: number | null
          kind?: string
          grid_w?: number
          grid_h?: number
          dock_capacity?: number | null
          serve_categories?: string[] | null
          storage_condition?: string | null
        }
        Update: {
          id?: string
          location_code?: string
          row?: string
          shelf?: string
          max_pallets?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
          warehouse_id?: string
          sub_code?: string
          sub_name?: string | null
          sub_type?: string | null
          requires_stocktake?: boolean | null
          created_by?: string | null
          updated_by?: string | null
          slot_no_in?: boolean
          slot_no_out?: boolean
          categories?: string[] | null
          search_norm?: string | null
          is_pick_face?: boolean
          max_materials?: number | null
          is_rack?: boolean
          level_no?: number | null
          grid_x?: number | null
          grid_y?: number | null
          kind?: string
          grid_w?: number
          grid_h?: number
          dock_capacity?: number | null
          serve_categories?: string[] | null
          storage_condition?: string | null
        }
        Relationships: []
      }
      LookupValue: {
        Row: {
          id: string
          type: string
          value: string
          sort_order: number
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
          meta: Json
        }
        Insert: {
          id?: string
          type: string
          value: string
          sort_order?: number
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          meta?: Json
        }
        Update: {
          id?: string
          type?: string
          value?: string
          sort_order?: number
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          meta?: Json
        }
        Relationships: []
      }
      Manufacturer: {
        Row: {
          id: string
          code: string
          name: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          code: string
          name?: string | null
          is_active?: boolean
          created_at?: string
          updated_at: string
        }
        Update: {
          id?: string
          code?: string
          name?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      Material: {
        Row: {
          id: string
          material_code: string
          material_description: string
          short_name: string | null
          custom_short_name: string | null
          product_type: string | null
          manufacturer_id: string | null
          notes: string | null
          is_active: boolean
          created_at: string
          updated_at: string
          cartons_per_pallet: number | null
          cartons_per_pallet_mn: number | null
          image_url: string | null
          old_code: string | null
          shelf_life_days: number | null
          storage_category: string | null
          units_per_carton: number | null
          weight_kg: number | null
          category: string | null
          pallet_per_ea: number | null
          warehouse_pallet_overrides: Json | null
          created_by: string | null
          updated_by: string | null
          supplier_shelf_life_overrides: Json | null
          no_qr_tracking: boolean
          batch_prefix: string | null
          carton_length_mm: number | null
          carton_width_mm: number | null
          carton_height_mm: number | null
          max_stack_layers: number | null
          stack_on_top: boolean
          base_unit: string | null
          entry_unit: string | null
          is_non_stock: boolean
          is_pallet_carrier: boolean
          search_norm: string | null
          pallet_color: string | null
        }
        Insert: {
          id: string
          material_code: string
          material_description: string
          short_name?: string | null
          custom_short_name?: string | null
          product_type?: string | null
          manufacturer_id?: string | null
          notes?: string | null
          is_active?: boolean
          created_at?: string
          updated_at: string
          cartons_per_pallet?: number | null
          cartons_per_pallet_mn?: number | null
          image_url?: string | null
          old_code?: string | null
          shelf_life_days?: number | null
          storage_category?: string | null
          units_per_carton?: number | null
          weight_kg?: number | null
          category?: string | null
          pallet_per_ea?: number | null
          warehouse_pallet_overrides?: Json | null
          created_by?: string | null
          updated_by?: string | null
          supplier_shelf_life_overrides?: Json | null
          no_qr_tracking?: boolean
          batch_prefix?: string | null
          carton_length_mm?: number | null
          carton_width_mm?: number | null
          carton_height_mm?: number | null
          max_stack_layers?: number | null
          stack_on_top?: boolean
          base_unit?: string | null
          entry_unit?: string | null
          is_non_stock?: boolean
          is_pallet_carrier?: boolean
          search_norm?: string | null
          pallet_color?: string | null
        }
        Update: {
          id?: string
          material_code?: string
          material_description?: string
          short_name?: string | null
          custom_short_name?: string | null
          product_type?: string | null
          manufacturer_id?: string | null
          notes?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          cartons_per_pallet?: number | null
          cartons_per_pallet_mn?: number | null
          image_url?: string | null
          old_code?: string | null
          shelf_life_days?: number | null
          storage_category?: string | null
          units_per_carton?: number | null
          weight_kg?: number | null
          category?: string | null
          pallet_per_ea?: number | null
          warehouse_pallet_overrides?: Json | null
          created_by?: string | null
          updated_by?: string | null
          supplier_shelf_life_overrides?: Json | null
          no_qr_tracking?: boolean
          batch_prefix?: string | null
          carton_length_mm?: number | null
          carton_width_mm?: number | null
          carton_height_mm?: number | null
          max_stack_layers?: number | null
          stack_on_top?: boolean
          base_unit?: string | null
          entry_unit?: string | null
          is_non_stock?: boolean
          is_pallet_carrier?: boolean
          search_norm?: string | null
          pallet_color?: string | null
        }
        Relationships: []
      }
      OutboundDelivery: {
        Row: {
          id: string
          gdo_id: string
          delivery_code: string | null
          distributor_name: string | null
          status: string
          created_at: string
          updated_at: string
          stop_seq: number | null
          ship_to_code: string | null
        }
        Insert: {
          id: string
          gdo_id: string
          delivery_code?: string | null
          distributor_name?: string | null
          status?: string
          created_at?: string
          updated_at: string
          stop_seq?: number | null
          ship_to_code?: string | null
        }
        Update: {
          id?: string
          gdo_id?: string
          delivery_code?: string | null
          distributor_name?: string | null
          status?: string
          created_at?: string
          updated_at?: string
          stop_seq?: number | null
          ship_to_code?: string | null
        }
        Relationships: []
      }
      OutboundItem: {
        Row: {
          id: string
          do_id: string
          material_id: string | null
          material_code_raw: string | null
          cartons_ordered: number
          boxes_display: number
          weight: number | null
          loose_picking: number
          pallets_estimated: number
          material_type: string | null
          export_type: string | null
          header_text: string | null
          batch_required: string | null
          cs_responsible: string | null
          cartons_scanned: number
          status: string
          created_at: string
          updated_at: string
          date_required: number | null
          od_refs: Json
          date_rule: Json | null
          pinned_pallets: string[] | null
        }
        Insert: {
          id: string
          do_id: string
          material_id?: string | null
          material_code_raw?: string | null
          cartons_ordered?: number
          boxes_display?: number
          weight?: number | null
          loose_picking?: number
          pallets_estimated?: number
          material_type?: string | null
          export_type?: string | null
          header_text?: string | null
          batch_required?: string | null
          cs_responsible?: string | null
          cartons_scanned?: number
          status?: string
          created_at?: string
          updated_at: string
          date_required?: number | null
          od_refs?: Json
          date_rule?: Json | null
          pinned_pallets?: string[] | null
        }
        Update: {
          id?: string
          do_id?: string
          material_id?: string | null
          material_code_raw?: string | null
          cartons_ordered?: number
          boxes_display?: number
          weight?: number | null
          loose_picking?: number
          pallets_estimated?: number
          material_type?: string | null
          export_type?: string | null
          header_text?: string | null
          batch_required?: string | null
          cs_responsible?: string | null
          cartons_scanned?: number
          status?: string
          created_at?: string
          updated_at?: string
          date_required?: number | null
          od_refs?: Json
          date_rule?: Json | null
          pinned_pallets?: string[] | null
        }
        Relationships: []
      }
      OutboundScanEntry: {
        Row: {
          id: string
          item_id: string
          inventory_entry_id: string | null
          pallet_code: string
          cartons_scanned: number
          scanned_by: string | null
          scanned_at: string
          created_at: string
          updated_at: string
          is_loose_picking: boolean
          best_available_date: string | null
          production_date: string | null
          loose_confirmed: boolean
          loose_confirmed_at: string | null
          pct_date: number | null
          loose_confirmed_by: string | null
          nmsx: string | null
          carton_scans: Json | null
          rotation_principle: string | null
          rotation_violation: boolean | null
          rotation_best_date: string | null
          rotation_override_reason: string | null
        }
        Insert: {
          id: string
          item_id: string
          inventory_entry_id?: string | null
          pallet_code: string
          cartons_scanned: number
          scanned_by?: string | null
          scanned_at?: string
          created_at?: string
          updated_at: string
          is_loose_picking?: boolean
          best_available_date?: string | null
          production_date?: string | null
          loose_confirmed?: boolean
          loose_confirmed_at?: string | null
          pct_date?: number | null
          loose_confirmed_by?: string | null
          nmsx?: string | null
          carton_scans?: Json | null
          rotation_principle?: string | null
          rotation_violation?: boolean | null
          rotation_best_date?: string | null
          rotation_override_reason?: string | null
        }
        Update: {
          id?: string
          item_id?: string
          inventory_entry_id?: string | null
          pallet_code?: string
          cartons_scanned?: number
          scanned_by?: string | null
          scanned_at?: string
          created_at?: string
          updated_at?: string
          is_loose_picking?: boolean
          best_available_date?: string | null
          production_date?: string | null
          loose_confirmed?: boolean
          loose_confirmed_at?: string | null
          pct_date?: number | null
          loose_confirmed_by?: string | null
          nmsx?: string | null
          carton_scans?: Json | null
          rotation_principle?: string | null
          rotation_violation?: boolean | null
          rotation_best_date?: string | null
          rotation_override_reason?: string | null
        }
        Relationships: []
      }
      PalletLabelPrint: {
        Row: {
          id: string
          qr_code: string
          material_code: string | null
          material_id: string | null
          category: string | null
          cycle: string | null
          machine: string | null
          seq: string | null
          nmsx: string | null
          qty: number | null
          mode: string
          printed_by: string | null
          printed_by_name: string | null
          warehouse_id: string | null
          created_at: string
          updated_at: string
          batch_id: string | null
        }
        Insert: {
          id?: string
          qr_code: string
          material_code?: string | null
          material_id?: string | null
          category?: string | null
          cycle?: string | null
          machine?: string | null
          seq?: string | null
          nmsx?: string | null
          qty?: number | null
          mode?: string
          printed_by?: string | null
          printed_by_name?: string | null
          warehouse_id?: string | null
          created_at?: string
          updated_at?: string
          batch_id?: string | null
        }
        Update: {
          id?: string
          qr_code?: string
          material_code?: string | null
          material_id?: string | null
          category?: string | null
          cycle?: string | null
          machine?: string | null
          seq?: string | null
          nmsx?: string | null
          qty?: number | null
          mode?: string
          printed_by?: string | null
          printed_by_name?: string | null
          warehouse_id?: string | null
          created_at?: string
          updated_at?: string
          batch_id?: string | null
        }
        Relationships: []
      }
      PalletOperation: {
        Row: {
          id: string
          type: string
          source_codes: string[]
          target_codes: string[]
          detail: Json | null
          operated_by: string | null
          operated_by_name: string | null
          warehouse_id: string | null
          created_at: string
          updated_at: string
          undone_at: string | null
          undone_by: string | null
          undone_by_name: string | null
        }
        Insert: {
          id?: string
          type: string
          source_codes?: string[]
          target_codes?: string[]
          detail?: Json | null
          operated_by?: string | null
          operated_by_name?: string | null
          warehouse_id?: string | null
          created_at?: string
          updated_at?: string
          undone_at?: string | null
          undone_by?: string | null
          undone_by_name?: string | null
        }
        Update: {
          id?: string
          type?: string
          source_codes?: string[]
          target_codes?: string[]
          detail?: Json | null
          operated_by?: string | null
          operated_by_name?: string | null
          warehouse_id?: string | null
          created_at?: string
          updated_at?: string
          undone_at?: string | null
          undone_by?: string | null
          undone_by_name?: string | null
        }
        Relationships: []
      }
      ProductionImport: {
        Row: {
          id: string
          import_code: string | null
          material_id: string | null
          imported_by: string | null
          import_date: string
          notes: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          location_id: string | null
          planned_pallets: number | null
          status: string
          updated_by: string | null
          warehouse_id: string | null
          shift_id: string | null
          source_type: string
          gate_registration_id: string | null
          tms_order_id: string | null
          planned_cartons: number | null
          warehouse_type: string | null
          from_gdo_id: string | null
          posm_entry_id: string | null
          posm_cartons: number | null
          location_history: Json
          ncc_id: string | null
          transfer_production_date: string | null
        }
        Insert: {
          id: string
          import_code?: string | null
          material_id?: string | null
          imported_by?: string | null
          import_date?: string
          notes?: string | null
          created_at?: string
          updated_at: string
          created_by?: string | null
          location_id?: string | null
          planned_pallets?: number | null
          status?: string
          updated_by?: string | null
          warehouse_id?: string | null
          shift_id?: string | null
          source_type?: string
          gate_registration_id?: string | null
          tms_order_id?: string | null
          planned_cartons?: number | null
          warehouse_type?: string | null
          from_gdo_id?: string | null
          posm_entry_id?: string | null
          posm_cartons?: number | null
          location_history?: Json
          ncc_id?: string | null
          transfer_production_date?: string | null
        }
        Update: {
          id?: string
          import_code?: string | null
          material_id?: string | null
          imported_by?: string | null
          import_date?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          location_id?: string | null
          planned_pallets?: number | null
          status?: string
          updated_by?: string | null
          warehouse_id?: string | null
          shift_id?: string | null
          source_type?: string
          gate_registration_id?: string | null
          tms_order_id?: string | null
          planned_cartons?: number | null
          warehouse_type?: string | null
          from_gdo_id?: string | null
          posm_entry_id?: string | null
          posm_cartons?: number | null
          location_history?: Json
          ncc_id?: string | null
          transfer_production_date?: string | null
        }
        Relationships: []
      }
      QAStatus: {
        Row: {
          id: string
          code: string
          name: string
          display_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          code: string
          name: string
          display_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          code?: string
          name?: string
          display_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      ShiftRestRule: {
        Row: {
          id: string
          from_shift: string
          to_shift: string
          created_at: string
        }
        Insert: {
          id: string
          from_shift: string
          to_shift: string
          created_at?: string
        }
        Update: {
          id?: string
          from_shift?: string
          to_shift?: string
          created_at?: string
        }
        Relationships: []
      }
      Skill: {
        Row: {
          id: string
          name: string
          shift_tag: string | null
          sort_order: number
          is_active: boolean
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
          job_title_id: string | null
        }
        Insert: {
          id: string
          name: string
          shift_tag?: string | null
          sort_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          job_title_id?: string | null
        }
        Update: {
          id?: string
          name?: string
          shift_tag?: string | null
          sort_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          job_title_id?: string | null
        }
        Relationships: []
      }
      SlotTemplate: {
        Row: {
          id: string
          vehicle_type_id: string
          direction: string | null
          cargo_type: string
          day_of_week: number
          time_from: string
          time_to: string
          max_vehicles: number
          is_active: boolean
          created_at: string
          updated_at: string
          warehouse_id: string
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id: string
          vehicle_type_id: string
          direction?: string | null
          cargo_type?: string
          day_of_week: number
          time_from: string
          time_to: string
          max_vehicles?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
          warehouse_id: string
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          vehicle_type_id?: string
          direction?: string | null
          cargo_type?: string
          day_of_week?: number
          time_from?: string
          time_to?: string
          max_vehicles?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
          warehouse_id?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      SlottingPlan: {
        Row: {
          id: string
          warehouse_id: string
          name: string
          status: string
          note: string | null
          window_days: number | null
          n_lines: number
          created_by: string | null
          created_at: string
          completed_at: string | null
          completed_by: string | null
          updated_at: string
          updated_by: string | null
          level: string | null
          principle: string | null
        }
        Insert: {
          id: string
          warehouse_id: string
          name: string
          status?: string
          note?: string | null
          window_days?: number | null
          n_lines?: number
          created_by?: string | null
          created_at?: string
          completed_at?: string | null
          completed_by?: string | null
          updated_at: string
          updated_by?: string | null
          level?: string | null
          principle?: string | null
        }
        Update: {
          id?: string
          warehouse_id?: string
          name?: string
          status?: string
          note?: string | null
          window_days?: number | null
          n_lines?: number
          created_by?: string | null
          created_at?: string
          completed_at?: string | null
          completed_by?: string | null
          updated_at?: string
          updated_by?: string | null
          level?: string | null
          principle?: string | null
        }
        Relationships: []
      }
      SlottingPlanLine: {
        Row: {
          id: string
          plan_id: string
          material_id: string
          material_code: string | null
          material_name: string | null
          date_key: string | null
          n_pallets: number
          entry_ids: Json
          abc: string | null
          reason: string | null
          flow_note: string | null
          from_location_id: string | null
          from_location_code: string | null
          to_location_id: string
          to_location_code: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          plan_id: string
          material_id: string
          material_code?: string | null
          material_name?: string | null
          date_key?: string | null
          n_pallets: number
          entry_ids: Json
          abc?: string | null
          reason?: string | null
          flow_note?: string | null
          from_location_id?: string | null
          from_location_code?: string | null
          to_location_id: string
          to_location_code?: string | null
          created_at?: string
          updated_at: string
        }
        Update: {
          id?: string
          plan_id?: string
          material_id?: string
          material_code?: string | null
          material_name?: string | null
          date_key?: string | null
          n_pallets?: number
          entry_ids?: Json
          abc?: string | null
          reason?: string | null
          flow_note?: string | null
          from_location_id?: string | null
          from_location_code?: string | null
          to_location_id?: string
          to_location_code?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      StocktakeLog: {
        Row: {
          id: string
          entry_id: string | null
          pallet_code: string
          location_id: string | null
          location_code: string | null
          warehouse_id: string | null
          material_id: string | null
          material_code: string | null
          short_name: string | null
          base_unit: string | null
          entry_unit: string | null
          units_per_carton: number | null
          app_qty: number | null
          physical_qty: number | null
          diff: number | null
          is_flagged: boolean | null
          note: string | null
          location_changed_to: string | null
          counted_by: string | null
          counted_by_name: string | null
          counted_at: string
          created_at: string | null
          updated_at: string | null
          categories: string[] | null
          location_from_id: string | null
          location_from_code: string | null
        }
        Insert: {
          id: string
          entry_id?: string | null
          pallet_code: string
          location_id?: string | null
          location_code?: string | null
          warehouse_id?: string | null
          material_id?: string | null
          material_code?: string | null
          short_name?: string | null
          base_unit?: string | null
          entry_unit?: string | null
          units_per_carton?: number | null
          app_qty?: number | null
          physical_qty?: number | null
          diff?: number | null
          is_flagged?: boolean | null
          note?: string | null
          location_changed_to?: string | null
          counted_by?: string | null
          counted_by_name?: string | null
          counted_at: string
          created_at?: string | null
          updated_at?: string | null
          categories?: string[] | null
          location_from_id?: string | null
          location_from_code?: string | null
        }
        Update: {
          id?: string
          entry_id?: string | null
          pallet_code?: string
          location_id?: string | null
          location_code?: string | null
          warehouse_id?: string | null
          material_id?: string | null
          material_code?: string | null
          short_name?: string | null
          base_unit?: string | null
          entry_unit?: string | null
          units_per_carton?: number | null
          app_qty?: number | null
          physical_qty?: number | null
          diff?: number | null
          is_flagged?: boolean | null
          note?: string | null
          location_changed_to?: string | null
          counted_by?: string | null
          counted_by_name?: string | null
          counted_at?: string
          created_at?: string | null
          updated_at?: string | null
          categories?: string[] | null
          location_from_id?: string | null
          location_from_code?: string | null
        }
        Relationships: []
      }
      SystemSetting: {
        Row: {
          key: string
          value: Json
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          key: string
          value: Json
          updated_by?: string | null
          updated_at: string
        }
        Update: {
          key?: string
          value?: Json
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      TmsOrder: {
        Row: {
          id: string
          order_code: string
          date: string
          warehouse_id: string
          ncc_id: string | null
          npp_name: string | null
          vehicle_type: string | null
          direction: string | null
          warehouse_type: string | null
          planned_boxes: number | null
          planned_pallets: number | null
          planned_tons: number | null
          gdo_refs: string | null
          notes: string | null
          status: string
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
          priority: boolean
          export_status: string | null
          material_id: string | null
          po_number: string | null
          is_unplanned: boolean
          source_type: string
          transfer_gdo_id: string | null
          destination_warehouse_id: string | null
          eta: string | null
          completed_at: string | null
          delivery_mode: string | null
          plan_group_key: string | null
          origin: string | null
          plan_dropped: boolean
          plan_dropped_at: string | null
          booking_category: string | null
        }
        Insert: {
          id?: string
          order_code: string
          date: string
          warehouse_id: string
          ncc_id?: string | null
          npp_name?: string | null
          vehicle_type?: string | null
          direction?: string | null
          warehouse_type?: string | null
          planned_boxes?: number | null
          planned_pallets?: number | null
          planned_tons?: number | null
          gdo_refs?: string | null
          notes?: string | null
          status?: string
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
          priority?: boolean
          export_status?: string | null
          material_id?: string | null
          po_number?: string | null
          is_unplanned?: boolean
          source_type?: string
          transfer_gdo_id?: string | null
          destination_warehouse_id?: string | null
          eta?: string | null
          completed_at?: string | null
          delivery_mode?: string | null
          plan_group_key?: string | null
          origin?: string | null
          plan_dropped?: boolean
          plan_dropped_at?: string | null
          booking_category?: string | null
        }
        Update: {
          id?: string
          order_code?: string
          date?: string
          warehouse_id?: string
          ncc_id?: string | null
          npp_name?: string | null
          vehicle_type?: string | null
          direction?: string | null
          warehouse_type?: string | null
          planned_boxes?: number | null
          planned_pallets?: number | null
          planned_tons?: number | null
          gdo_refs?: string | null
          notes?: string | null
          status?: string
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
          priority?: boolean
          export_status?: string | null
          material_id?: string | null
          po_number?: string | null
          is_unplanned?: boolean
          source_type?: string
          transfer_gdo_id?: string | null
          destination_warehouse_id?: string | null
          eta?: string | null
          completed_at?: string | null
          delivery_mode?: string | null
          plan_group_key?: string | null
          origin?: string | null
          plan_dropped?: boolean
          plan_dropped_at?: string | null
          booking_category?: string | null
        }
        Relationships: []
      }
      TmsVehicleSlot: {
        Row: {
          id: string
          order_id: string
          slot_id: string | null
          license_plate: string | null
          driver_name: string | null
          driver_phone: string | null
          status: string
          booked_by: string | null
          created_at: string
          updated_at: string
          consolidation_group_id: string | null
          is_consolidation_primary: boolean
          gate_export_status: string | null
          gate_registered_at: string | null
          gate_entry_at: string | null
          gate_exit_at: string | null
          gate_registration_id: string | null
        }
        Insert: {
          id?: string
          order_id: string
          slot_id?: string | null
          license_plate?: string | null
          driver_name?: string | null
          driver_phone?: string | null
          status?: string
          booked_by?: string | null
          created_at?: string
          updated_at?: string
          consolidation_group_id?: string | null
          is_consolidation_primary?: boolean
          gate_export_status?: string | null
          gate_registered_at?: string | null
          gate_entry_at?: string | null
          gate_exit_at?: string | null
          gate_registration_id?: string | null
        }
        Update: {
          id?: string
          order_id?: string
          slot_id?: string | null
          license_plate?: string | null
          driver_name?: string | null
          driver_phone?: string | null
          status?: string
          booked_by?: string | null
          created_at?: string
          updated_at?: string
          consolidation_group_id?: string | null
          is_consolidation_primary?: boolean
          gate_export_status?: string | null
          gate_registered_at?: string | null
          gate_entry_at?: string | null
          gate_exit_at?: string | null
          gate_registration_id?: string | null
        }
        Relationships: []
      }
      TransportCompany: {
        Row: {
          id: string
          code: string
          name: string
          contact_name: string | null
          contact_phone: string | null
          is_active: boolean
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
          type: string | null
          alias_codes: string[]
          tender_required: boolean
        }
        Insert: {
          id: string
          code: string
          name: string
          contact_name?: string | null
          contact_phone?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          type?: string | null
          alias_codes?: string[]
          tender_required?: boolean
        }
        Update: {
          id?: string
          code?: string
          name?: string
          contact_name?: string | null
          contact_phone?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          type?: string | null
          alias_codes?: string[]
          tender_required?: boolean
        }
        Relationships: []
      }
      UserWarehouseAccess: {
        Row: {
          id: string
          employee_id: string
          warehouse_id: string
          created_at: string
        }
        Insert: {
          id: string
          employee_id: string
          warehouse_id: string
          created_at?: string
        }
        Update: {
          id?: string
          employee_id?: string
          warehouse_id?: string
          created_at?: string
        }
        Relationships: []
      }
      Vehicle: {
        Row: {
          id: string
          ncc_id: string
          license_plate: string
          vehicle_type_id: string
          is_active: boolean
          created_at: string
          updated_at: string
          box_length_mm: number | null
          box_width_mm: number | null
          box_height_mm: number | null
        }
        Insert: {
          id: string
          ncc_id: string
          license_plate: string
          vehicle_type_id: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
          box_length_mm?: number | null
          box_width_mm?: number | null
          box_height_mm?: number | null
        }
        Update: {
          id?: string
          ncc_id?: string
          license_plate?: string
          vehicle_type_id?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
          box_length_mm?: number | null
          box_width_mm?: number | null
          box_height_mm?: number | null
        }
        Relationships: []
      }
      VehicleType: {
        Row: {
          id: string
          code: string
          name: string
          is_active: boolean
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
          sort_order: number
          box_length_mm: number | null
          box_width_mm: number | null
          box_height_mm: number | null
          is_pallet_truck: boolean
          allow_multi_vehicle: boolean
          detour_pct: number | null
        }
        Insert: {
          id: string
          code: string
          name: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          sort_order?: number
          box_length_mm?: number | null
          box_width_mm?: number | null
          box_height_mm?: number | null
          is_pallet_truck?: boolean
          allow_multi_vehicle?: boolean
          detour_pct?: number | null
        }
        Update: {
          id?: string
          code?: string
          name?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          sort_order?: number
          box_length_mm?: number | null
          box_width_mm?: number | null
          box_height_mm?: number | null
          is_pallet_truck?: boolean
          allow_multi_vehicle?: boolean
          detour_pct?: number | null
        }
        Relationships: []
      }
      Warehouse: {
        Row: {
          id: string
          code: string
          name: string
          address: string | null
          is_active: boolean
          created_at: string
          updated_at: string
          nmsx_code: string | null
          warehouse_type: string
          created_by: string | null
          updated_by: string | null
          inventory_mode: string
          shipto_codes: string[]
          parent_warehouse_id: string | null
          carton_scan_override: boolean | null
          carton_scan_categories: string[] | null
          carton_scan_require_full: boolean
          sap_plant: string | null
          sap_storage_locations: string[]
          require_weigh_on_start: boolean
          require_gate_on_start: boolean
          rotation_principle: string
          rotation_required: boolean
          putaway_priority: string
          putaway_required: boolean
          putaway_date_mix: string
          putaway_block_pick_face: boolean
          putaway_block_qa_hold: boolean
          putaway_block_full: boolean
          putaway_single_ncc: boolean
          putaway_enforced: string[]
          putaway_same_mat_date_pref: string
          putaway_fallback: string
          scan_code_types: string
          loose_mode: string | null
          loose_max_cartons: number | null
          work_mode: string
          lower_from_level: number
          date_rule_policy: string
          separate_lowering_forklift: boolean
          cross_trip_pick_radius: number
          auto_fill: boolean
          dispatch_allow_mix_channels: boolean
          dispatch_underload_pct: number | null
          dispatch_pallet_max_stops: number
          dispatch_allow_mix_categories: boolean
          dispatch_max_vehicles_per_trip: number
          unlinked_shipto_policy: string
          dispatch_load_bands: Json | null
          geo_lat: number | null
          geo_lng: number | null
          geo_source: string | null
          geo_accuracy_m: number | null
          geo_at: string | null
          geo_by: string | null
        }
        Insert: {
          id: string
          code: string
          name: string
          address?: string | null
          is_active?: boolean
          created_at?: string
          updated_at: string
          nmsx_code?: string | null
          warehouse_type?: string
          created_by?: string | null
          updated_by?: string | null
          inventory_mode?: string
          shipto_codes?: string[]
          parent_warehouse_id?: string | null
          carton_scan_override?: boolean | null
          carton_scan_categories?: string[] | null
          carton_scan_require_full?: boolean
          sap_plant?: string | null
          sap_storage_locations?: string[]
          require_weigh_on_start?: boolean
          require_gate_on_start?: boolean
          rotation_principle?: string
          rotation_required?: boolean
          putaway_priority?: string
          putaway_required?: boolean
          putaway_date_mix?: string
          putaway_block_pick_face?: boolean
          putaway_block_qa_hold?: boolean
          putaway_block_full?: boolean
          putaway_single_ncc?: boolean
          putaway_enforced?: string[]
          putaway_same_mat_date_pref?: string
          putaway_fallback?: string
          scan_code_types?: string
          loose_mode?: string | null
          loose_max_cartons?: number | null
          work_mode?: string
          lower_from_level?: number
          date_rule_policy?: string
          separate_lowering_forklift?: boolean
          cross_trip_pick_radius?: number
          auto_fill?: boolean
          dispatch_allow_mix_channels?: boolean
          dispatch_underload_pct?: number | null
          dispatch_pallet_max_stops?: number
          dispatch_allow_mix_categories?: boolean
          dispatch_max_vehicles_per_trip?: number
          unlinked_shipto_policy?: string
          dispatch_load_bands?: Json | null
          geo_lat?: number | null
          geo_lng?: number | null
          geo_source?: string | null
          geo_accuracy_m?: number | null
          geo_at?: string | null
          geo_by?: string | null
        }
        Update: {
          id?: string
          code?: string
          name?: string
          address?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          nmsx_code?: string | null
          warehouse_type?: string
          created_by?: string | null
          updated_by?: string | null
          inventory_mode?: string
          shipto_codes?: string[]
          parent_warehouse_id?: string | null
          carton_scan_override?: boolean | null
          carton_scan_categories?: string[] | null
          carton_scan_require_full?: boolean
          sap_plant?: string | null
          sap_storage_locations?: string[]
          require_weigh_on_start?: boolean
          require_gate_on_start?: boolean
          rotation_principle?: string
          rotation_required?: boolean
          putaway_priority?: string
          putaway_required?: boolean
          putaway_date_mix?: string
          putaway_block_pick_face?: boolean
          putaway_block_qa_hold?: boolean
          putaway_block_full?: boolean
          putaway_single_ncc?: boolean
          putaway_enforced?: string[]
          putaway_same_mat_date_pref?: string
          putaway_fallback?: string
          scan_code_types?: string
          loose_mode?: string | null
          loose_max_cartons?: number | null
          work_mode?: string
          lower_from_level?: number
          date_rule_policy?: string
          separate_lowering_forklift?: boolean
          cross_trip_pick_radius?: number
          auto_fill?: boolean
          dispatch_allow_mix_channels?: boolean
          dispatch_underload_pct?: number | null
          dispatch_pallet_max_stops?: number
          dispatch_allow_mix_categories?: boolean
          dispatch_max_vehicles_per_trip?: number
          unlinked_shipto_policy?: string
          dispatch_load_bands?: Json | null
          geo_lat?: number | null
          geo_lng?: number | null
          geo_source?: string | null
          geo_accuracy_m?: number | null
          geo_at?: string | null
          geo_by?: string | null
        }
        Relationships: []
      }
      WarehouseZone: {
        Row: {
          id: string
          warehouse_id: string
          code: string
          name: string
          sort_order: number
          is_active: boolean
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
          pick_rank: number | null
          flow_type: string | null
          max_pallets: number | null
          categories: string[]
        }
        Insert: {
          id?: string
          warehouse_id: string
          code: string
          name: string
          sort_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          pick_rank?: number | null
          flow_type?: string | null
          max_pallets?: number | null
          categories: string[]
        }
        Update: {
          id?: string
          warehouse_id?: string
          code?: string
          name?: string
          sort_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          pick_rank?: number | null
          flow_type?: string | null
          max_pallets?: number | null
          categories?: string[]
        }
        Relationships: []
      }
      WeighTicket: {
        Row: {
          id: string
          station_code: string
          source_id: number
          ticket_no: string | null
          weigh_date: string | null
          license_plate: string | null
          license_plate_norm: string | null
          direction: string | null
          goods_name: string | null
          trans_company: string | null
          tare_kg: number | null
          tare_at: string | null
          gross_kg: number | null
          gross_at: string | null
          net_kg: number | null
          in_time: string | null
          out_time: string | null
          is_complete: boolean
          gdo_id: string | null
          matched_at: string | null
          matched_by: string | null
          raw: Json | null
          created_at: string
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          id: string
          station_code?: string
          source_id: number
          ticket_no?: string | null
          weigh_date?: string | null
          license_plate?: string | null
          license_plate_norm?: string | null
          direction?: string | null
          goods_name?: string | null
          trans_company?: string | null
          tare_kg?: number | null
          tare_at?: string | null
          gross_kg?: number | null
          gross_at?: string | null
          net_kg?: number | null
          in_time?: string | null
          out_time?: string | null
          is_complete?: boolean
          gdo_id?: string | null
          matched_at?: string | null
          matched_by?: string | null
          raw?: Json | null
          created_at?: string
          updated_at: string
          warehouse_id?: string | null
        }
        Update: {
          id?: string
          station_code?: string
          source_id?: number
          ticket_no?: string | null
          weigh_date?: string | null
          license_plate?: string | null
          license_plate_norm?: string | null
          direction?: string | null
          goods_name?: string | null
          trans_company?: string | null
          tare_kg?: number | null
          tare_at?: string | null
          gross_kg?: number | null
          gross_at?: string | null
          net_kg?: number | null
          in_time?: string | null
          out_time?: string | null
          is_complete?: boolean
          gdo_id?: string | null
          matched_at?: string | null
          matched_by?: string | null
          raw?: Json | null
          created_at?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: []
      }
      WorkAssignment: {
        Row: {
          id: string
          sheet_id: string
          employee_id: string
          skill_id: string | null
          status: string
          is_manual: boolean
          note: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          sheet_id: string
          employee_id: string
          skill_id?: string | null
          status?: string
          is_manual?: boolean
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          sheet_id?: string
          employee_id?: string
          skill_id?: string | null
          status?: string
          is_manual?: boolean
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      WorkAssignmentDemand: {
        Row: {
          id: string
          sheet_id: string
          skill_id: string
          required_count: number
          created_at: string
          updated_at: string
          note: string | null
        }
        Insert: {
          id: string
          sheet_id: string
          skill_id: string
          required_count?: number
          created_at?: string
          updated_at?: string
          note?: string | null
        }
        Update: {
          id?: string
          sheet_id?: string
          skill_id?: string
          required_count?: number
          created_at?: string
          updated_at?: string
          note?: string | null
        }
        Relationships: []
      }
      WorkAssignmentSheet: {
        Row: {
          id: string
          work_date: string
          status: string
          note: string | null
          published_at: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
          warehouse_id: string | null
          layout_id: string | null
        }
        Insert: {
          id: string
          work_date: string
          status?: string
          note?: string | null
          published_at?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          warehouse_id?: string | null
          layout_id?: string | null
        }
        Update: {
          id?: string
          work_date?: string
          status?: string
          note?: string | null
          published_at?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          warehouse_id?: string | null
          layout_id?: string | null
        }
        Relationships: []
      }
      WorkLayout: {
        Row: {
          id: string
          warehouse_id: string
          name: string
          note: string | null
          is_active: boolean
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id: string
          warehouse_id: string
          name: string
          note?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          warehouse_id?: string
          name?: string
          note?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      WorkLayoutJobTitle: {
        Row: {
          id: string
          layout_id: string
          job_title_id: string
          created_at: string
        }
        Insert: {
          id: string
          layout_id: string
          job_title_id: string
          created_at?: string
        }
        Update: {
          id?: string
          layout_id?: string
          job_title_id?: string
          created_at?: string
        }
        Relationships: []
      }
      WorkLayoutSkill: {
        Row: {
          id: string
          layout_id: string
          skill_id: string
          required_count: number
          sort_order: number
          created_at: string
          updated_at: string
          note: string | null
        }
        Insert: {
          id: string
          layout_id: string
          skill_id: string
          required_count?: number
          sort_order?: number
          created_at?: string
          updated_at?: string
          note?: string | null
        }
        Update: {
          id?: string
          layout_id?: string
          skill_id?: string
          required_count?: number
          sort_order?: number
          created_at?: string
          updated_at?: string
          note?: string | null
        }
        Relationships: []
      }
      _prisma_migrations: {
        Row: {
          id: string
          checksum: string
          finished_at: string | null
          migration_name: string
          logs: string | null
          rolled_back_at: string | null
          started_at: string
          applied_steps_count: number
        }
        Insert: {
          id: string
          checksum: string
          finished_at?: string | null
          migration_name: string
          logs?: string | null
          rolled_back_at?: string | null
          started_at?: string
          applied_steps_count?: number
        }
        Update: {
          id?: string
          checksum?: string
          finished_at?: string | null
          migration_name?: string
          logs?: string | null
          rolled_back_at?: string | null
          started_at?: string
          applied_steps_count?: number
        }
        Relationships: []
      }
      admin_audit_events: {
        Row: {
          id: string
          actor_id: string | null
          actor_name: string | null
          ip: string | null
          action: string
          target_type: string
          target_id: string | null
          target_label: string | null
          before: Json | null
          after: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          actor_id?: string | null
          actor_name?: string | null
          ip?: string | null
          action: string
          target_type: string
          target_id?: string | null
          target_label?: string | null
          before?: Json | null
          after?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          actor_id?: string | null
          actor_name?: string | null
          ip?: string | null
          action?: string
          target_type?: string
          target_id?: string | null
          target_label?: string | null
          before?: Json | null
          after?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      alert_events: {
        Row: {
          id: string
          rule: string
          dedup_key: string
          severity: string
          warehouse_id: string | null
          category: string | null
          title: string
          detail: string | null
          object_url: string | null
          first_seen: string
          last_seen: string
          pushed_at: string | null
          ack_by: string | null
          ack_at: string | null
          resolved_at: string | null
          created_at: string
          updated_at: string
          warehouse_name: string | null
        }
        Insert: {
          id?: string
          rule: string
          dedup_key: string
          severity: string
          warehouse_id?: string | null
          category?: string | null
          title: string
          detail?: string | null
          object_url?: string | null
          first_seen?: string
          last_seen?: string
          pushed_at?: string | null
          ack_by?: string | null
          ack_at?: string | null
          resolved_at?: string | null
          created_at?: string
          updated_at?: string
          warehouse_name?: string | null
        }
        Update: {
          id?: string
          rule?: string
          dedup_key?: string
          severity?: string
          warehouse_id?: string | null
          category?: string | null
          title?: string
          detail?: string | null
          object_url?: string | null
          first_seen?: string
          last_seen?: string
          pushed_at?: string | null
          ack_by?: string | null
          ack_at?: string | null
          resolved_at?: string | null
          created_at?: string
          updated_at?: string
          warehouse_name?: string | null
        }
        Relationships: []
      }
      auth_attempts: {
        Row: {
          key: string
          fails: number
          window_start: string
          locked_until: string | null
          updated_at: string
        }
        Insert: {
          key: string
          fails?: number
          window_start?: string
          locked_until?: string | null
          updated_at?: string
        }
        Update: {
          key?: string
          fails?: number
          window_start?: string
          locked_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      auth_login_events: {
        Row: {
          id: string
          email: string | null
          ip: string | null
          ok: boolean
          reason: string | null
          employee_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          email?: string | null
          ip?: string | null
          ok: boolean
          reason?: string | null
          employee_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          email?: string | null
          ip?: string | null
          ok?: boolean
          reason?: string | null
          employee_id?: string | null
          created_at?: string
        }
        Relationships: []
      }
      base_unit_flip_round_report: {
        Row: {
          id: number
          tbl: string
          row_id: string
          col: string
          old_val: number
          factor: number
          exact_base: number
          new_val: number
          diff_base: number
          flipped_at: string
        }
        Insert: {
          id?: number
          tbl: string
          row_id: string
          col: string
          old_val: number
          factor: number
          exact_base: number
          new_val: number
          diff_base: number
          flipped_at?: string
        }
        Update: {
          id?: number
          tbl?: string
          row_id?: string
          col?: string
          old_val?: number
          factor?: number
          exact_base?: number
          new_val?: number
          diff_base?: number
          flipped_at?: string
        }
        Relationships: []
      }
      carrier_allocation: {
        Row: {
          id: string
          from_warehouse_id: string
          area_kind: string
          area_code: string
          transport_company_id: string
          priority: number
          effective_from: string
          effective_to: string | null
          is_active: boolean
          note: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id: string
          from_warehouse_id: string
          area_kind: string
          area_code: string
          transport_company_id: string
          priority?: number
          effective_from?: string
          effective_to?: string | null
          is_active?: boolean
          note?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          from_warehouse_id?: string
          area_kind?: string
          area_code?: string
          transport_company_id?: string
          priority?: number
          effective_from?: string
          effective_to?: string | null
          is_active?: boolean
          note?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      carrier_share_target: {
        Row: {
          id: string
          from_warehouse_id: string
          transport_company_id: string
          share_pct: number
          basis: string
          period: string
          effective_from: string
          effective_to: string | null
          is_active: boolean
          note: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id: string
          from_warehouse_id: string
          transport_company_id: string
          share_pct: number
          basis?: string
          period?: string
          effective_from?: string
          effective_to?: string | null
          is_active?: boolean
          note?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          from_warehouse_id?: string
          transport_company_id?: string
          share_pct?: number
          basis?: string
          period?: string
          effective_from?: string
          effective_to?: string | null
          is_active?: boolean
          note?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      dashboard_cache: {
        Row: {
          key: string
          payload: Json
          computed_at: string
        }
        Insert: {
          key: string
          payload: Json
          computed_at?: string
        }
        Update: {
          key?: string
          payload?: Json
          computed_at?: string
        }
        Relationships: []
      }
      date_rule_master: {
        Row: {
          id: string
          scope: string
          scope_key: string
          category: string | null
          rule: Json
          note: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id: string
          scope: string
          scope_key: string
          category?: string | null
          rule: Json
          note?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          scope?: string
          scope_key?: string
          category?: string | null
          rule?: Json
          note?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      dispatch_od_hidden: {
        Row: {
          id: string
          plan_id: string
          od_number: string
          user_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          plan_id: string
          od_number: string
          user_id: string
          created_at?: string
          updated_at: string
        }
        Update: {
          id?: string
          plan_id?: string
          od_number?: string
          user_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      dispatch_od_hold: {
        Row: {
          id: string
          warehouse_id: string
          od_number: string
          hold_until: string | null
          reason: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          warehouse_id: string
          od_number: string
          hold_until?: string | null
          reason: string
          created_by?: string | null
          created_at?: string
          updated_at: string
        }
        Update: {
          id?: string
          warehouse_id?: string
          od_number?: string
          hold_until?: string | null
          reason?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      dispatch_od_outside: {
        Row: {
          id: string
          warehouse_id: string
          od_number: string
          reason: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          warehouse_id: string
          od_number: string
          reason: string
          created_by?: string | null
          created_at?: string
          updated_at: string
        }
        Update: {
          id?: string
          warehouse_id?: string
          od_number?: string
          reason?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      dispatch_od_segment: {
        Row: {
          id: string
          warehouse_id: string
          od_number: string
          segment: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          warehouse_id: string
          od_number: string
          segment: string
          created_by?: string | null
          created_at?: string
          updated_at: string
        }
        Update: {
          id?: string
          warehouse_id?: string
          od_number?: string
          segment?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      dispatch_plan: {
        Row: {
          id: string
          warehouse_id: string
          plan_date: string
          status: string
          params: Json
          summary: Json
          unplanned: Json
          engine_version: string | null
          created_by: string | null
          confirmed_by: string | null
          confirmed_at: string | null
          created_at: string
          updated_at: string
          busy_until: string | null
          busy_token: string | null
          segment: string
        }
        Insert: {
          id: string
          warehouse_id: string
          plan_date: string
          status?: string
          params?: Json
          summary?: Json
          unplanned?: Json
          engine_version?: string | null
          created_by?: string | null
          confirmed_by?: string | null
          confirmed_at?: string | null
          created_at?: string
          updated_at: string
          busy_until?: string | null
          busy_token?: string | null
          segment?: string
        }
        Update: {
          id?: string
          warehouse_id?: string
          plan_date?: string
          status?: string
          params?: Json
          summary?: Json
          unplanned?: Json
          engine_version?: string | null
          created_by?: string | null
          confirmed_by?: string | null
          confirmed_at?: string | null
          created_at?: string
          updated_at?: string
          busy_until?: string | null
          busy_token?: string | null
          segment?: string
        }
        Relationships: []
      }
      dispatch_trip: {
        Row: {
          id: string
          plan_id: string
          seq: number
          group_code: string
          vehicle_model_id: string | null
          transport_company_id: string | null
          stops: number
          wards: string[]
          pallets: number | null
          tons: number | null
          load_pct: number | null
          underload: boolean
          oversize: boolean
          freight_estimated: number | null
          detail: Json
          manual_edited: boolean
          created_at: string
          updated_at: string
          status: string
          tendered_at: string | null
          responded_at: string | null
          response_by: string | null
          response_note: string | null
          confirmed_at: string | null
          locked: boolean
          load_mode: string | null
          allow_mix_categories: boolean | null
          extra_vehicle_model_ids: string[]
        }
        Insert: {
          id: string
          plan_id: string
          seq: number
          group_code: string
          vehicle_model_id?: string | null
          transport_company_id?: string | null
          stops?: number
          wards?: string[]
          pallets?: number | null
          tons?: number | null
          load_pct?: number | null
          underload?: boolean
          oversize?: boolean
          freight_estimated?: number | null
          detail?: Json
          manual_edited?: boolean
          created_at?: string
          updated_at: string
          status?: string
          tendered_at?: string | null
          responded_at?: string | null
          response_by?: string | null
          response_note?: string | null
          confirmed_at?: string | null
          locked?: boolean
          load_mode?: string | null
          allow_mix_categories?: boolean | null
          extra_vehicle_model_ids?: string[]
        }
        Update: {
          id?: string
          plan_id?: string
          seq?: number
          group_code?: string
          vehicle_model_id?: string | null
          transport_company_id?: string | null
          stops?: number
          wards?: string[]
          pallets?: number | null
          tons?: number | null
          load_pct?: number | null
          underload?: boolean
          oversize?: boolean
          freight_estimated?: number | null
          detail?: Json
          manual_edited?: boolean
          created_at?: string
          updated_at?: string
          status?: string
          tendered_at?: string | null
          responded_at?: string | null
          response_by?: string | null
          response_note?: string | null
          confirmed_at?: string | null
          locked?: boolean
          load_mode?: string | null
          allow_mix_categories?: boolean | null
          extra_vehicle_model_ids?: string[]
        }
        Relationships: []
      }
      dispatch_trip_od: {
        Row: {
          id: string
          trip_id: string | null
          od_number: string
          ship_to_code: string | null
          ship_to_name: string | null
          ward_code: string | null
          pallets: number | null
          tons: number | null
          lines: number
          part_index: number | null
          part_of: number | null
          material_codes: string[]
          created_at: string
          updated_at: string
          plan_id: string
          conditions: string[]
          cat_load: Json | null
          region_code: string | null
          delivery_date: string | null
          late_days: number
          load_mode: string | null
          is_transfer: boolean
          max_vehicle_tons: number | null
          allowed_models: string[] | null
          note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sap_sig: string | null
          region_name: string | null
          separate: boolean
          max_customers: number | null
        }
        Insert: {
          id: string
          trip_id?: string | null
          od_number: string
          ship_to_code?: string | null
          ship_to_name?: string | null
          ward_code?: string | null
          pallets?: number | null
          tons?: number | null
          lines?: number
          part_index?: number | null
          part_of?: number | null
          material_codes?: string[]
          created_at?: string
          updated_at: string
          plan_id: string
          conditions?: string[]
          cat_load?: Json | null
          region_code?: string | null
          delivery_date?: string | null
          late_days?: number
          load_mode?: string | null
          is_transfer?: boolean
          max_vehicle_tons?: number | null
          allowed_models?: string[] | null
          note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sap_sig?: string | null
          region_name?: string | null
          separate?: boolean
          max_customers?: number | null
        }
        Update: {
          id?: string
          trip_id?: string | null
          od_number?: string
          ship_to_code?: string | null
          ship_to_name?: string | null
          ward_code?: string | null
          pallets?: number | null
          tons?: number | null
          lines?: number
          part_index?: number | null
          part_of?: number | null
          material_codes?: string[]
          created_at?: string
          updated_at?: string
          plan_id?: string
          conditions?: string[]
          cat_load?: Json | null
          region_code?: string | null
          delivery_date?: string | null
          late_days?: number
          load_mode?: string | null
          is_transfer?: boolean
          max_vehicle_tons?: number | null
          allowed_models?: string[] | null
          note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sap_sig?: string | null
          region_name?: string | null
          separate?: boolean
          max_customers?: number | null
        }
        Relationships: []
      }
      erp_outbound_orders: {
        Row: {
          id: string
          od_number: string
          od_item: string
          material_code: string | null
          material_name: string | null
          qty_sales: number | null
          sales_unit: string | null
          qty_base: number | null
          base_unit: string | null
          ship_to_code: string | null
          ship_to_name: string | null
          plant: string | null
          storage_location: string | null
          batch: string | null
          batch_so: string | null
          date_req: number | null
          pct_date_req: number | null
          note_delivery: string | null
          note_invoice: string | null
          shipping_point: string | null
          license_plate: string | null
          source: string
          raw: Json | null
          uploaded_by: string | null
          created_at: string
          updated_at: string
          sync_status: string
          last_synced_at: string | null
          manual_edited_at: string | null
          so_number: string | null
          so_item: string | null
          so_type: string | null
          item_category: string | null
          flow: string | null
          delivery_date: string | null
          sales_org: string | null
          dist_channel: string | null
          sold_to_code: string | null
          ward_code: string | null
          region_code: string | null
          sales_district: string | null
          route_code: string | null
          route_name: string | null
          dvvt_code: string | null
          dvvt_raw: string | null
          driver_name: string | null
          sap_dispatch_status: string | null
          qty_so_sales: number | null
          qty_issued_base: number | null
          gross_weight_kg: number | null
          sap_pallets: number | null
          sap_m3: number | null
          mat_doc: string | null
          billing_no: string | null
          so_created_at: string | null
          od_created_at: string | null
          approval_status: string | null
          customer_ref: string | null
          replaced_by_od: string | null
          replaced_at: string | null
          in_khvc: boolean
        }
        Insert: {
          id: string
          od_number: string
          od_item: string
          material_code?: string | null
          material_name?: string | null
          qty_sales?: number | null
          sales_unit?: string | null
          qty_base?: number | null
          base_unit?: string | null
          ship_to_code?: string | null
          ship_to_name?: string | null
          plant?: string | null
          storage_location?: string | null
          batch?: string | null
          batch_so?: string | null
          date_req?: number | null
          pct_date_req?: number | null
          note_delivery?: string | null
          note_invoice?: string | null
          shipping_point?: string | null
          license_plate?: string | null
          source?: string
          raw?: Json | null
          uploaded_by?: string | null
          created_at?: string
          updated_at: string
          sync_status?: string
          last_synced_at?: string | null
          manual_edited_at?: string | null
          so_number?: string | null
          so_item?: string | null
          so_type?: string | null
          item_category?: string | null
          flow?: string | null
          delivery_date?: string | null
          sales_org?: string | null
          dist_channel?: string | null
          sold_to_code?: string | null
          ward_code?: string | null
          region_code?: string | null
          sales_district?: string | null
          route_code?: string | null
          route_name?: string | null
          dvvt_code?: string | null
          dvvt_raw?: string | null
          driver_name?: string | null
          sap_dispatch_status?: string | null
          qty_so_sales?: number | null
          qty_issued_base?: number | null
          gross_weight_kg?: number | null
          sap_pallets?: number | null
          sap_m3?: number | null
          mat_doc?: string | null
          billing_no?: string | null
          so_created_at?: string | null
          od_created_at?: string | null
          approval_status?: string | null
          customer_ref?: string | null
          replaced_by_od?: string | null
          replaced_at?: string | null
          in_khvc?: boolean
        }
        Update: {
          id?: string
          od_number?: string
          od_item?: string
          material_code?: string | null
          material_name?: string | null
          qty_sales?: number | null
          sales_unit?: string | null
          qty_base?: number | null
          base_unit?: string | null
          ship_to_code?: string | null
          ship_to_name?: string | null
          plant?: string | null
          storage_location?: string | null
          batch?: string | null
          batch_so?: string | null
          date_req?: number | null
          pct_date_req?: number | null
          note_delivery?: string | null
          note_invoice?: string | null
          shipping_point?: string | null
          license_plate?: string | null
          source?: string
          raw?: Json | null
          uploaded_by?: string | null
          created_at?: string
          updated_at?: string
          sync_status?: string
          last_synced_at?: string | null
          manual_edited_at?: string | null
          so_number?: string | null
          so_item?: string | null
          so_type?: string | null
          item_category?: string | null
          flow?: string | null
          delivery_date?: string | null
          sales_org?: string | null
          dist_channel?: string | null
          sold_to_code?: string | null
          ward_code?: string | null
          region_code?: string | null
          sales_district?: string | null
          route_code?: string | null
          route_name?: string | null
          dvvt_code?: string | null
          dvvt_raw?: string | null
          driver_name?: string | null
          sap_dispatch_status?: string | null
          qty_so_sales?: number | null
          qty_issued_base?: number | null
          gross_weight_kg?: number | null
          sap_pallets?: number | null
          sap_m3?: number | null
          mat_doc?: string | null
          billing_no?: string | null
          so_created_at?: string | null
          od_created_at?: string | null
          approval_status?: string | null
          customer_ref?: string | null
          replaced_by_od?: string | null
          replaced_at?: string | null
          in_khvc?: boolean
        }
        Relationships: []
      }
      erp_so_lines: {
        Row: {
          id: string
          so_number: string
          so_item: string
          od_number: string | null
          material_code: string | null
          material_name: string | null
          qty_so_sales: number | null
          sales_unit: string | null
          qty_so_cartons: number | null
          qty_so_base: number | null
          qty_base_derived: boolean
          derive_source: string | null
          qty_unresolved: boolean
          base_unit: string | null
          ship_to_code: string | null
          ship_to_name: string | null
          sold_to_code: string | null
          plant: string | null
          storage_location: string | null
          delivery_date: string | null
          flow: string | null
          so_type: string | null
          item_category: string | null
          status: string
          cancel_reason: string | null
          approval_status: string | null
          ward_code: string | null
          region_code: string | null
          route_code: string | null
          route_name: string | null
          sap_pallets: number | null
          sap_m3: number | null
          gross_weight_kg: number | null
          note_delivery: string | null
          sync_status: string
          source: string
          raw: Json | null
          uploaded_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          so_number: string
          so_item: string
          od_number?: string | null
          material_code?: string | null
          material_name?: string | null
          qty_so_sales?: number | null
          sales_unit?: string | null
          qty_so_cartons?: number | null
          qty_so_base?: number | null
          qty_base_derived?: boolean
          derive_source?: string | null
          qty_unresolved?: boolean
          base_unit?: string | null
          ship_to_code?: string | null
          ship_to_name?: string | null
          sold_to_code?: string | null
          plant?: string | null
          storage_location?: string | null
          delivery_date?: string | null
          flow?: string | null
          so_type?: string | null
          item_category?: string | null
          status?: string
          cancel_reason?: string | null
          approval_status?: string | null
          ward_code?: string | null
          region_code?: string | null
          route_code?: string | null
          route_name?: string | null
          sap_pallets?: number | null
          sap_m3?: number | null
          gross_weight_kg?: number | null
          note_delivery?: string | null
          sync_status?: string
          source?: string
          raw?: Json | null
          uploaded_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          so_number?: string
          so_item?: string
          od_number?: string | null
          material_code?: string | null
          material_name?: string | null
          qty_so_sales?: number | null
          sales_unit?: string | null
          qty_so_cartons?: number | null
          qty_so_base?: number | null
          qty_base_derived?: boolean
          derive_source?: string | null
          qty_unresolved?: boolean
          base_unit?: string | null
          ship_to_code?: string | null
          ship_to_name?: string | null
          sold_to_code?: string | null
          plant?: string | null
          storage_location?: string | null
          delivery_date?: string | null
          flow?: string | null
          so_type?: string | null
          item_category?: string | null
          status?: string
          cancel_reason?: string | null
          approval_status?: string | null
          ward_code?: string | null
          region_code?: string | null
          route_code?: string | null
          route_name?: string | null
          sap_pallets?: number | null
          sap_m3?: number | null
          gross_weight_kg?: number | null
          note_delivery?: string | null
          sync_status?: string
          source?: string
          raw?: Json | null
          uploaded_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      error_logs: {
        Row: {
          id: string
          created_at: string
          source: string
          status: number | null
          code: string | null
          message: string
          url: string | null
          ua: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          source: string
          status?: number | null
          code?: string | null
          message: string
          url?: string | null
          ua?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          source?: string
          status?: number | null
          code?: string | null
          message?: string
          url?: string | null
          ua?: string | null
        }
        Relationships: []
      }
      fill_reconcile_queue: {
        Row: {
          warehouse_id: string
          target_date: string
          queued_at: string
        }
        Insert: {
          warehouse_id: string
          target_date: string
          queued_at?: string
        }
        Update: {
          warehouse_id?: string
          target_date?: string
          queued_at?: string
        }
        Relationships: []
      }
      fill_reconcile_state: {
        Row: {
          warehouse_id: string
          last_sweep: string | null
          lease_until: string | null
          updated_at: string
        }
        Insert: {
          warehouse_id: string
          last_sweep?: string | null
          lease_until?: string | null
          updated_at?: string
        }
        Update: {
          warehouse_id?: string
          last_sweep?: string | null
          lease_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      forklift_checklist_items: {
        Row: {
          id: string
          label: string
          sort_order: number
          is_active: boolean
          created_at: string
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          id?: string
          label: string
          sort_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          id?: string
          label?: string
          sort_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: []
      }
      forklift_daily_logs: {
        Row: {
          id: string
          forklift_id: string
          log_date: string
          status: string
          hour_meter: number | null
          checklist: Json
          issue_count: number
          note: string | null
          checked_by: string | null
          checked_by_id: string | null
          created_at: string
          updated_at: string
          photo_path: string | null
        }
        Insert: {
          id?: string
          forklift_id: string
          log_date: string
          status?: string
          hour_meter?: number | null
          checklist?: Json
          issue_count?: number
          note?: string | null
          checked_by?: string | null
          checked_by_id?: string | null
          created_at?: string
          updated_at?: string
          photo_path?: string | null
        }
        Update: {
          id?: string
          forklift_id?: string
          log_date?: string
          status?: string
          hour_meter?: number | null
          checklist?: Json
          issue_count?: number
          note?: string | null
          checked_by?: string | null
          checked_by_id?: string | null
          created_at?: string
          updated_at?: string
          photo_path?: string | null
        }
        Relationships: []
      }
      forklift_vehicles: {
        Row: {
          id: string
          code: string
          name: string | null
          warehouse_id: string
          is_active: boolean
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          code: string
          name?: string | null
          warehouse_id: string
          is_active?: boolean
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          code?: string
          name?: string | null
          warehouse_id?: string
          is_active?: boolean
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      freight_surcharge: {
        Row: {
          id: string
          from_warehouse_id: string
          transport_company_id: string
          vehicle_model_id: string | null
          kind: string
          amount: number
          per: string
          count_mode: string
          min_stops: number
          effective_from: string
          effective_to: string | null
          is_active: boolean
          note: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id: string
          from_warehouse_id: string
          transport_company_id: string
          vehicle_model_id?: string | null
          kind: string
          amount: number
          per?: string
          count_mode?: string
          min_stops?: number
          effective_from?: string
          effective_to?: string | null
          is_active?: boolean
          note?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          from_warehouse_id?: string
          transport_company_id?: string
          vehicle_model_id?: string | null
          kind?: string
          amount?: number
          per?: string
          count_mode?: string
          min_stops?: number
          effective_from?: string
          effective_to?: string | null
          is_active?: boolean
          note?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      freight_tariff: {
        Row: {
          id: string
          from_warehouse_id: string
          transport_company_id: string
          vehicle_model_id: string
          ward_code: string
          price: number
          distance_km: number | null
          province_old: string | null
          district_old: string | null
          province_new: string | null
          ward_raw: string | null
          effective_from: string
          effective_to: string | null
          is_active: boolean
          note: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id: string
          from_warehouse_id: string
          transport_company_id: string
          vehicle_model_id: string
          ward_code: string
          price: number
          distance_km?: number | null
          province_old?: string | null
          district_old?: string | null
          province_new?: string | null
          ward_raw?: string | null
          effective_from?: string
          effective_to?: string | null
          is_active?: boolean
          note?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          from_warehouse_id?: string
          transport_company_id?: string
          vehicle_model_id?: string
          ward_code?: string
          price?: number
          distance_km?: number | null
          province_old?: string | null
          district_old?: string | null
          province_new?: string | null
          ward_raw?: string | null
          effective_from?: string
          effective_to?: string | null
          is_active?: boolean
          note?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      gate_registrations: {
        Row: {
          id: string
          date: string
          registration_number: number
          driver_name: string | null
          phone: string | null
          company_id: string | null
          company_name_raw: string | null
          vehicle_id: string | null
          license_plate: string | null
          direction: string | null
          warehouse_id: string
          warehouse_type: string | null
          vehicle_type: string | null
          content: string | null
          return_pallet: boolean
          seal_number: string | null
          notes: string | null
          status: string
          priority: boolean
          registered_at: string | null
          registered_by: string | null
          called_at: string | null
          called_by: string | null
          entry_at: string | null
          entry_by: string | null
          exit_at: string | null
          exit_by: string | null
          load_capacity: number | null
          tms_order_id: string | null
          tms_vehicle_slot_id: string | null
          booking_order_code: string | null
          booking_slot_from: string | null
          booking_slot_to: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
          tms_order_ids: string | null
          booking_npp_names: string | null
          booking_gdo_refs: string | null
          booking_planned_boxes: string | null
          booking_planned_pallets: string | null
          visit_group_id: string | null
        }
        Insert: {
          id?: string
          date: string
          registration_number: number
          driver_name?: string | null
          phone?: string | null
          company_id?: string | null
          company_name_raw?: string | null
          vehicle_id?: string | null
          license_plate?: string | null
          direction?: string | null
          warehouse_id: string
          warehouse_type?: string | null
          vehicle_type?: string | null
          content?: string | null
          return_pallet?: boolean
          seal_number?: string | null
          notes?: string | null
          status?: string
          priority?: boolean
          registered_at?: string | null
          registered_by?: string | null
          called_at?: string | null
          called_by?: string | null
          entry_at?: string | null
          entry_by?: string | null
          exit_at?: string | null
          exit_by?: string | null
          load_capacity?: number | null
          tms_order_id?: string | null
          tms_vehicle_slot_id?: string | null
          booking_order_code?: string | null
          booking_slot_from?: string | null
          booking_slot_to?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
          tms_order_ids?: string | null
          booking_npp_names?: string | null
          booking_gdo_refs?: string | null
          booking_planned_boxes?: string | null
          booking_planned_pallets?: string | null
          visit_group_id?: string | null
        }
        Update: {
          id?: string
          date?: string
          registration_number?: number
          driver_name?: string | null
          phone?: string | null
          company_id?: string | null
          company_name_raw?: string | null
          vehicle_id?: string | null
          license_plate?: string | null
          direction?: string | null
          warehouse_id?: string
          warehouse_type?: string | null
          vehicle_type?: string | null
          content?: string | null
          return_pallet?: boolean
          seal_number?: string | null
          notes?: string | null
          status?: string
          priority?: boolean
          registered_at?: string | null
          registered_by?: string | null
          called_at?: string | null
          called_by?: string | null
          entry_at?: string | null
          entry_by?: string | null
          exit_at?: string | null
          exit_by?: string | null
          load_capacity?: number | null
          tms_order_id?: string | null
          tms_vehicle_slot_id?: string | null
          booking_order_code?: string | null
          booking_slot_from?: string | null
          booking_slot_to?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
          tms_order_ids?: string | null
          booking_npp_names?: string | null
          booking_gdo_refs?: string | null
          booking_planned_boxes?: string | null
          booking_planned_pallets?: string | null
          visit_group_id?: string | null
        }
        Relationships: []
      }
      geo_distance: {
        Row: {
          id: string
          from_key: string
          to_key: string
          from_lat: number
          from_lng: number
          to_lat: number
          to_lng: number
          km: number
          minutes: number | null
          source: string
          measured_at: string
          updated_at: string
        }
        Insert: {
          id: string
          from_key: string
          to_key: string
          from_lat: number
          from_lng: number
          to_lat: number
          to_lng: number
          km: number
          minutes?: number | null
          source: string
          measured_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          from_key?: string
          to_key?: string
          from_lat?: number
          from_lng?: number
          to_lat?: number
          to_lng?: number
          km?: number
          minutes?: number | null
          source?: string
          measured_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      inbound_plan_lines: {
        Row: {
          id: string
          date: string
          warehouse_id: string
          warehouse_type: string | null
          vehicle_type: string | null
          ncc_id: string | null
          material_id: string | null
          po_number: string | null
          planned_boxes: number | null
          planned_pallets: number | null
          tms_order_id: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
          status: string
          cancel_reason: string | null
        }
        Insert: {
          id?: string
          date: string
          warehouse_id: string
          warehouse_type?: string | null
          vehicle_type?: string | null
          ncc_id?: string | null
          material_id?: string | null
          po_number?: string | null
          planned_boxes?: number | null
          planned_pallets?: number | null
          tms_order_id?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
          status?: string
          cancel_reason?: string | null
        }
        Update: {
          id?: string
          date?: string
          warehouse_id?: string
          warehouse_type?: string | null
          vehicle_type?: string | null
          ncc_id?: string | null
          material_id?: string | null
          po_number?: string | null
          planned_boxes?: number | null
          planned_pallets?: number | null
          tms_order_id?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
          status?: string
          cancel_reason?: string | null
        }
        Relationships: []
      }
      khvc_lines: {
        Row: {
          id: string
          group_code: string
          do_no: string
          warehouse_code: string | null
          npp: string | null
          veh_type: string | null
          dvvt: string | null
          priority: string | null
          cs: string | null
          note: string | null
          export_date: string | null
          source: string
          sync_status: string
          gdo_id: string | null
          raw: Json | null
          uploaded_by: string | null
          created_at: string
          updated_at: string
          manual_edited_at: string | null
          booking_category: string | null
          vehicle_model_id: string | null
          extra_vehicle_model_ids: string[]
          stop_seq: number | null
        }
        Insert: {
          id: string
          group_code: string
          do_no: string
          warehouse_code?: string | null
          npp?: string | null
          veh_type?: string | null
          dvvt?: string | null
          priority?: string | null
          cs?: string | null
          note?: string | null
          export_date?: string | null
          source?: string
          sync_status?: string
          gdo_id?: string | null
          raw?: Json | null
          uploaded_by?: string | null
          created_at?: string
          updated_at: string
          manual_edited_at?: string | null
          booking_category?: string | null
          vehicle_model_id?: string | null
          extra_vehicle_model_ids?: string[]
          stop_seq?: number | null
        }
        Update: {
          id?: string
          group_code?: string
          do_no?: string
          warehouse_code?: string | null
          npp?: string | null
          veh_type?: string | null
          dvvt?: string | null
          priority?: string | null
          cs?: string | null
          note?: string | null
          export_date?: string | null
          source?: string
          sync_status?: string
          gdo_id?: string | null
          raw?: Json | null
          uploaded_by?: string | null
          created_at?: string
          updated_at?: string
          manual_edited_at?: string | null
          booking_category?: string | null
          vehicle_model_id?: string | null
          extra_vehicle_model_ids?: string[]
          stop_seq?: number | null
        }
        Relationships: []
      }
      notification_prefs: {
        Row: {
          employee_id: string
          prefs: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          employee_id: string
          prefs?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          employee_id?: string
          prefs?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      od_lineage: {
        Row: {
          id: string
          so_number: string | null
          so_item: string | null
          old_od: string
          new_od: string
          kind: string
          qty_old: number | null
          qty_new: number | null
          detected_at: string
          source: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolution: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          so_number?: string | null
          so_item?: string | null
          old_od: string
          new_od: string
          kind: string
          qty_old?: number | null
          qty_new?: number | null
          detected_at?: string
          source?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolution?: string | null
          created_at?: string
          updated_at: string
        }
        Update: {
          id?: string
          so_number?: string | null
          so_item?: string | null
          old_od?: string
          new_od?: string
          kind?: string
          qty_old?: number | null
          qty_new?: number | null
          detected_at?: string
          source?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolution?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      outbound_events: {
        Row: {
          id: string
          gdo_id: string | null
          group_code: string
          event_type: string
          source: string
          actor: string | null
          do_number: string | null
          material_code: string | null
          old_value: string | null
          new_value: string | null
          detail: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          gdo_id?: string | null
          group_code: string
          event_type: string
          source: string
          actor?: string | null
          do_number?: string | null
          material_code?: string | null
          old_value?: string | null
          new_value?: string | null
          detail: string
          created_at?: string
          updated_at: string
        }
        Update: {
          id?: string
          gdo_id?: string | null
          group_code?: string
          event_type?: string
          source?: string
          actor?: string | null
          do_number?: string | null
          material_code?: string | null
          old_value?: string | null
          new_value?: string | null
          detail?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      packing_logs: {
        Row: {
          id: string
          pallet_code: string
          material_code: string | null
          material_id: string | null
          machine_code: string | null
          warehouse_id: string | null
          qty_cartons: number | null
          qty_source: string
          status: string
          open_scan_at: string
          close_scan_at: string | null
          prod_start_at: string | null
          prod_end_at: string | null
          prod_start_src: string | null
          prod_end_src: string | null
          ocr_start_raw: string | null
          ocr_end_raw: string | null
          photo_start_path: string | null
          photo_end_path: string | null
          packed_by: string | null
          packed_by_name: string | null
          note: string | null
          created_at: string | null
          updated_at: string
          run_id: string | null
        }
        Insert: {
          id: string
          pallet_code: string
          material_code?: string | null
          material_id?: string | null
          machine_code?: string | null
          warehouse_id?: string | null
          qty_cartons?: number | null
          qty_source?: string
          status?: string
          open_scan_at: string
          close_scan_at?: string | null
          prod_start_at?: string | null
          prod_end_at?: string | null
          prod_start_src?: string | null
          prod_end_src?: string | null
          ocr_start_raw?: string | null
          ocr_end_raw?: string | null
          photo_start_path?: string | null
          photo_end_path?: string | null
          packed_by?: string | null
          packed_by_name?: string | null
          note?: string | null
          created_at?: string | null
          updated_at: string
          run_id?: string | null
        }
        Update: {
          id?: string
          pallet_code?: string
          material_code?: string | null
          material_id?: string | null
          machine_code?: string | null
          warehouse_id?: string | null
          qty_cartons?: number | null
          qty_source?: string
          status?: string
          open_scan_at?: string
          close_scan_at?: string | null
          prod_start_at?: string | null
          prod_end_at?: string | null
          prod_start_src?: string | null
          prod_end_src?: string | null
          ocr_start_raw?: string | null
          ocr_end_raw?: string | null
          photo_start_path?: string | null
          photo_end_path?: string | null
          packed_by?: string | null
          packed_by_name?: string | null
          note?: string | null
          created_at?: string | null
          updated_at?: string
          run_id?: string | null
        }
        Relationships: []
      }
      packing_runs: {
        Row: {
          id: string
          warehouse_id: string
          run_date: string
          shift: string | null
          cycle: string | null
          material_code: string
          material_id: string | null
          machine_code: string
          start_at: string
          end_at: string | null
          qty_total: number | null
          pallet_count: number | null
          status: string
          opened_by: string | null
          opened_by_name: string | null
          closed_by: string | null
          closed_by_name: string | null
          note: string | null
          created_at: string
          updated_at: string
          material_codes: string[] | null
        }
        Insert: {
          id: string
          warehouse_id: string
          run_date: string
          shift?: string | null
          cycle?: string | null
          material_code: string
          material_id?: string | null
          machine_code: string
          start_at: string
          end_at?: string | null
          qty_total?: number | null
          pallet_count?: number | null
          status?: string
          opened_by?: string | null
          opened_by_name?: string | null
          closed_by?: string | null
          closed_by_name?: string | null
          note?: string | null
          created_at?: string
          updated_at: string
          material_codes?: string[] | null
        }
        Update: {
          id?: string
          warehouse_id?: string
          run_date?: string
          shift?: string | null
          cycle?: string | null
          material_code?: string
          material_id?: string | null
          machine_code?: string
          start_at?: string
          end_at?: string | null
          qty_total?: number | null
          pallet_count?: number | null
          status?: string
          opened_by?: string | null
          opened_by_name?: string | null
          closed_by?: string | null
          closed_by_name?: string | null
          note?: string | null
          created_at?: string
          updated_at?: string
          material_codes?: string[] | null
        }
        Relationships: []
      }
      push_config: {
        Row: {
          id: number
          vapid_public: string
          vapid_private: string
          subject: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id: number
          vapid_public: string
          vapid_private: string
          subject: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          vapid_public?: string
          vapid_private?: string
          subject?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          id: string
          employee_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent: string | null
          failed_n: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          employee_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent?: string | null
          failed_n?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          employee_id?: string
          endpoint?: string
          p256dh?: string
          auth?: string
          user_agent?: string | null
          failed_n?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      receipt_ratings: {
        Row: {
          id: string
          gdo_id: string
          tms_order_id: string | null
          from_warehouse_id: string | null
          to_warehouse_id: string | null
          stars: number
          reason_code: string | null
          note: string | null
          rated_by: string | null
          rated_by_name: string | null
          rated_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          gdo_id: string
          tms_order_id?: string | null
          from_warehouse_id?: string | null
          to_warehouse_id?: string | null
          stars: number
          reason_code?: string | null
          note?: string | null
          rated_by?: string | null
          rated_by_name?: string | null
          rated_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          gdo_id?: string
          tms_order_id?: string | null
          from_warehouse_id?: string | null
          to_warehouse_id?: string | null
          stars?: number
          reason_code?: string | null
          note?: string | null
          rated_by?: string | null
          rated_by_name?: string | null
          rated_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      reconcile_tasks: {
        Row: {
          id: string
          item_id: string | null
          gdo_id: string | null
          group_code: string | null
          material_code: string | null
          material_name: string | null
          od_number: string | null
          od_item: string | null
          change_type: string
          zone: string
          action: string
          status: string
          old_ordered: number | null
          new_ordered: number | null
          scanned: number | null
          detail: string | null
          actor: string | null
          resolution: string | null
          resolved_by: string | null
          resolved_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          item_id?: string | null
          gdo_id?: string | null
          group_code?: string | null
          material_code?: string | null
          material_name?: string | null
          od_number?: string | null
          od_item?: string | null
          change_type: string
          zone: string
          action: string
          status?: string
          old_ordered?: number | null
          new_ordered?: number | null
          scanned?: number | null
          detail?: string | null
          actor?: string | null
          resolution?: string | null
          resolved_by?: string | null
          resolved_at?: string | null
          created_at?: string
          updated_at: string
        }
        Update: {
          id?: string
          item_id?: string | null
          gdo_id?: string | null
          group_code?: string | null
          material_code?: string | null
          material_name?: string | null
          od_number?: string | null
          od_item?: string | null
          change_type?: string
          zone?: string
          action?: string
          status?: string
          old_ordered?: number | null
          new_ordered?: number | null
          scanned?: number | null
          detail?: string | null
          actor?: string | null
          resolution?: string | null
          resolved_by?: string | null
          resolved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      sap_route: {
        Row: {
          route_code: string
          route_name: string
          plant: string | null
          ward_code: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          route_code: string
          route_name: string
          plant?: string | null
          ward_code?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          route_code?: string
          route_name?: string
          plant?: string | null
          ward_code?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      trace_investigations: {
        Row: {
          id: string
          carton_at: string
          material_code: string | null
          machine_code: string | null
          cycle: string | null
          note: string | null
          result_note: string | null
          photos: string[]
          matched: Json
          trace: Json | null
          performed_by: string | null
          performed_by_name: string | null
          created_at: string
          updated_at: string
          run_id: string | null
        }
        Insert: {
          id: string
          carton_at: string
          material_code?: string | null
          machine_code?: string | null
          cycle?: string | null
          note?: string | null
          result_note?: string | null
          photos?: string[]
          matched?: Json
          trace?: Json | null
          performed_by?: string | null
          performed_by_name?: string | null
          created_at: string
          updated_at: string
          run_id?: string | null
        }
        Update: {
          id?: string
          carton_at?: string
          material_code?: string | null
          machine_code?: string | null
          cycle?: string | null
          note?: string | null
          result_note?: string | null
          photos?: string[]
          matched?: Json
          trace?: Json | null
          performed_by?: string | null
          performed_by_name?: string | null
          created_at?: string
          updated_at?: string
          run_id?: string | null
        }
        Relationships: []
      }
      user_notifications: {
        Row: {
          id: string
          employee_id: string
          kind: string
          title: string
          body: string | null
          url: string | null
          read_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          employee_id: string
          kind: string
          title: string
          body?: string | null
          url?: string | null
          read_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          employee_id?: string
          kind?: string
          title?: string
          body?: string | null
          url?: string | null
          read_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      vehicle_model: {
        Row: {
          id: string
          sap_code: string
          name: string
          parent_type_id: string | null
          temp_mode: string | null
          capacity_mode: string
          max_pallets: number | null
          max_tons: number | null
          max_drops: number | null
          allow_mix_channels: boolean
          tariff_unit: string
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
          storage_conditions: string[]
          note: string | null
          dispatch_use: string
          allow_multi_vehicle: boolean | null
          detour_pct: number | null
        }
        Insert: {
          id: string
          sap_code: string
          name: string
          parent_type_id?: string | null
          temp_mode?: string | null
          capacity_mode?: string
          max_pallets?: number | null
          max_tons?: number | null
          max_drops?: number | null
          allow_mix_channels?: boolean
          tariff_unit?: string
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          storage_conditions?: string[]
          note?: string | null
          dispatch_use?: string
          allow_multi_vehicle?: boolean | null
          detour_pct?: number | null
        }
        Update: {
          id?: string
          sap_code?: string
          name?: string
          parent_type_id?: string | null
          temp_mode?: string | null
          capacity_mode?: string
          max_pallets?: number | null
          max_tons?: number | null
          max_drops?: number | null
          allow_mix_channels?: boolean
          tariff_unit?: string
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          storage_conditions?: string[]
          note?: string | null
          dispatch_use?: string
          allow_multi_vehicle?: boolean | null
          detour_pct?: number | null
        }
        Relationships: []
      }
      warehouse_cost_locks: {
        Row: {
          id: string
          warehouse_id: string | null
          period: string
          locked_at: string
          locked_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          warehouse_id?: string | null
          period: string
          locked_at?: string
          locked_by?: string | null
          created_at?: string
          updated_at: string
        }
        Update: {
          id?: string
          warehouse_id?: string | null
          period?: string
          locked_at?: string
          locked_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      warehouse_costs: {
        Row: {
          id: string
          warehouse_id: string | null
          period: string
          cost_item: string
          amount: number
          note: string | null
          created_at: string
          created_by: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id: string
          warehouse_id?: string | null
          period: string
          cost_item: string
          amount?: number
          note?: string | null
          created_at?: string
          created_by?: string | null
          updated_at: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          warehouse_id?: string | null
          period?: string
          cost_item?: string
          amount?: number
          note?: string | null
          created_at?: string
          created_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      warehouse_machines: {
        Row: {
          id: string
          warehouse_id: string
          code: string
          note: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          warehouse_id: string
          code: string
          note?: string | null
          is_active?: boolean
          created_at?: string
          updated_at: string
        }
        Update: {
          id?: string
          warehouse_id?: string
          code?: string
          note?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      warehouse_maps: {
        Row: {
          warehouse_id: string
          width: number
          height: number
          cell_m: number
          blocked: Json
          notes: string | null
          created_at: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          warehouse_id: string
          width: number
          height: number
          cell_m?: number
          blocked?: Json
          notes?: string | null
          created_at?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          warehouse_id?: string
          width?: number
          height?: number
          cell_m?: number
          blocked?: Json
          notes?: string | null
          created_at?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      warehouse_type_configs: {
        Row: {
          id: string
          warehouse_id: string
          type_code: string
          rotation_principle: string | null
          rotation_required: boolean | null
          putaway_priority: string | null
          putaway_enforced: string[] | null
          putaway_date_mix: string | null
          putaway_block_pick_face: boolean | null
          putaway_block_qa_hold: boolean | null
          putaway_block_full: boolean | null
          putaway_single_ncc: boolean | null
          putaway_same_mat_date_pref: string | null
          putaway_fallback: string | null
          created_at: string
          updated_at: string
          updated_by: string | null
          sort_order: number | null
          is_ncc_goods: boolean | null
          requires_ncc: boolean | null
          batch_char: string | null
          loose_mode: string | null
          loose_max_cartons: number | null
          putaway_enforced_off: string[] | null
          work_mode: string | null
          lower_from_level: number | null
          auto_fill: boolean | null
        }
        Insert: {
          id: string
          warehouse_id: string
          type_code: string
          rotation_principle?: string | null
          rotation_required?: boolean | null
          putaway_priority?: string | null
          putaway_enforced?: string[] | null
          putaway_date_mix?: string | null
          putaway_block_pick_face?: boolean | null
          putaway_block_qa_hold?: boolean | null
          putaway_block_full?: boolean | null
          putaway_single_ncc?: boolean | null
          putaway_same_mat_date_pref?: string | null
          putaway_fallback?: string | null
          created_at?: string
          updated_at: string
          updated_by?: string | null
          sort_order?: number | null
          is_ncc_goods?: boolean | null
          requires_ncc?: boolean | null
          batch_char?: string | null
          loose_mode?: string | null
          loose_max_cartons?: number | null
          putaway_enforced_off?: string[] | null
          work_mode?: string | null
          lower_from_level?: number | null
          auto_fill?: boolean | null
        }
        Update: {
          id?: string
          warehouse_id?: string
          type_code?: string
          rotation_principle?: string | null
          rotation_required?: boolean | null
          putaway_priority?: string | null
          putaway_enforced?: string[] | null
          putaway_date_mix?: string | null
          putaway_block_pick_face?: boolean | null
          putaway_block_qa_hold?: boolean | null
          putaway_block_full?: boolean | null
          putaway_single_ncc?: boolean | null
          putaway_same_mat_date_pref?: string | null
          putaway_fallback?: string | null
          created_at?: string
          updated_at?: string
          updated_by?: string | null
          sort_order?: number | null
          is_ncc_goods?: boolean | null
          requires_ncc?: boolean | null
          batch_char?: string | null
          loose_mode?: string | null
          loose_max_cartons?: number | null
          putaway_enforced_off?: string[] | null
          work_mode?: string | null
          lower_from_level?: number | null
          auto_fill?: boolean | null
        }
        Relationships: []
      }
      warehouse_vehicle_model: {
        Row: {
          id: string
          warehouse_id: string
          vehicle_model_id: string
          is_active: boolean | null
          max_pallets: number | null
          max_tons: number | null
          max_drops: number | null
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
          allow_multi_vehicle: boolean | null
          detour_pct: number | null
        }
        Insert: {
          id: string
          warehouse_id: string
          vehicle_model_id: string
          is_active?: boolean | null
          max_pallets?: number | null
          max_tons?: number | null
          max_drops?: number | null
          created_at?: string
          updated_at: string
          created_by?: string | null
          updated_by?: string | null
          allow_multi_vehicle?: boolean | null
          detour_pct?: number | null
        }
        Update: {
          id?: string
          warehouse_id?: string
          vehicle_model_id?: string
          is_active?: boolean | null
          max_pallets?: number | null
          max_tons?: number | null
          max_drops?: number | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          allow_multi_vehicle?: boolean | null
          detour_pct?: number | null
        }
        Relationships: []
      }
      wms_replan_queue: {
        Row: {
          warehouse_id: string
          material_id: string
          queued_at: string
        }
        Insert: {
          warehouse_id: string
          material_id: string
          queued_at?: string
        }
        Update: {
          warehouse_id?: string
          material_id?: string
          queued_at?: string
        }
        Relationships: []
      }
      wms_task_events: {
        Row: {
          id: string
          task_id: string
          event: string
          actor: string | null
          at: string
          note: string | null
        }
        Insert: {
          id: string
          task_id: string
          event: string
          actor?: string | null
          at: string
          note?: string | null
        }
        Update: {
          id?: string
          task_id?: string
          event?: string
          actor?: string | null
          at?: string
          note?: string | null
        }
        Relationships: []
      }
      wms_tasks: {
        Row: {
          id: string
          warehouse_id: string
          gdo_id: string
          item_id: string
          entry_id: string | null
          pallet_code: string
          material_id: string | null
          material_code: string | null
          qty_base: number
          is_partial: boolean
          kind: string
          from_location_id: string | null
          from_location_code: string | null
          level_no: number | null
          needs_lower: boolean
          drop_location_id: string | null
          to_location_id: string | null
          to_kind: string | null
          dist_cells: number | null
          seq: number
          status: string
          lowered_at: string | null
          lowered_by: string | null
          moved_at: string | null
          moved_by: string | null
          confirm_source: string | null
          done_at: string | null
          done_by: string | null
          scan_entry_id: string | null
          skip_reason: string | null
          plan_version: number
          created_at: string
          updated_at: string
          claimed_by: string | null
          claimed_at: string | null
        }
        Insert: {
          id: string
          warehouse_id: string
          gdo_id: string
          item_id: string
          entry_id?: string | null
          pallet_code: string
          material_id?: string | null
          material_code?: string | null
          qty_base: number
          is_partial?: boolean
          kind?: string
          from_location_id?: string | null
          from_location_code?: string | null
          level_no?: number | null
          needs_lower?: boolean
          drop_location_id?: string | null
          to_location_id?: string | null
          to_kind?: string | null
          dist_cells?: number | null
          seq: number
          status?: string
          lowered_at?: string | null
          lowered_by?: string | null
          moved_at?: string | null
          moved_by?: string | null
          confirm_source?: string | null
          done_at?: string | null
          done_by?: string | null
          scan_entry_id?: string | null
          skip_reason?: string | null
          plan_version?: number
          created_at: string
          updated_at: string
          claimed_by?: string | null
          claimed_at?: string | null
        }
        Update: {
          id?: string
          warehouse_id?: string
          gdo_id?: string
          item_id?: string
          entry_id?: string | null
          pallet_code?: string
          material_id?: string | null
          material_code?: string | null
          qty_base?: number
          is_partial?: boolean
          kind?: string
          from_location_id?: string | null
          from_location_code?: string | null
          level_no?: number | null
          needs_lower?: boolean
          drop_location_id?: string | null
          to_location_id?: string | null
          to_kind?: string | null
          dist_cells?: number | null
          seq?: number
          status?: string
          lowered_at?: string | null
          lowered_by?: string | null
          moved_at?: string | null
          moved_by?: string | null
          confirm_source?: string | null
          done_at?: string | null
          done_by?: string | null
          scan_entry_id?: string | null
          skip_reason?: string | null
          plan_version?: number
          created_at?: string
          updated_at?: string
          claimed_by?: string | null
          claimed_at?: string | null
        }
        Relationships: []
      }
      x_bak_20260826_max_materials: {
        Row: {
          nguon: string | null
          ban_ghi: string | null
          ten: string | null
          gia_tri_cu: number | null
        }
        Insert: {
          nguon?: string | null
          ban_ghi?: string | null
          ten?: string | null
          gia_tri_cu?: number | null
        }
        Update: {
          nguon?: string | null
          ban_ghi?: string | null
          ten?: string | null
          gia_tri_cu?: number | null
        }
        Relationships: []
      }
      x_bak_jobtitle_perms_20260912i: {
        Row: {
          id: string | null
          name: string | null
          module_permissions: Json | null
          backed_up_at: string | null
        }
        Insert: {
          id?: string | null
          name?: string | null
          module_permissions?: Json | null
          backed_up_at?: string | null
        }
        Update: {
          id?: string | null
          name?: string | null
          module_permissions?: Json | null
          backed_up_at?: string | null
        }
        Relationships: []
      }
      x_bak_order_dup_20260725: {
        Row: {
          id: string | null
          order_code: string | null
          date: string | null
          warehouse_id: string | null
          ncc_id: string | null
          npp_name: string | null
          vehicle_type: string | null
          direction: string | null
          warehouse_type: string | null
          planned_boxes: number | null
          planned_pallets: number | null
          planned_tons: number | null
          gdo_refs: string | null
          notes: string | null
          status: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string | null
          updated_at: string | null
          priority: boolean | null
          export_status: string | null
          material_id: string | null
          po_number: string | null
          is_unplanned: boolean | null
          source_type: string | null
          transfer_gdo_id: string | null
          destination_warehouse_id: string | null
          eta: string | null
          completed_at: string | null
          delivery_mode: string | null
        }
        Insert: {
          id?: string | null
          order_code?: string | null
          date?: string | null
          warehouse_id?: string | null
          ncc_id?: string | null
          npp_name?: string | null
          vehicle_type?: string | null
          direction?: string | null
          warehouse_type?: string | null
          planned_boxes?: number | null
          planned_pallets?: number | null
          planned_tons?: number | null
          gdo_refs?: string | null
          notes?: string | null
          status?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          priority?: boolean | null
          export_status?: string | null
          material_id?: string | null
          po_number?: string | null
          is_unplanned?: boolean | null
          source_type?: string | null
          transfer_gdo_id?: string | null
          destination_warehouse_id?: string | null
          eta?: string | null
          completed_at?: string | null
          delivery_mode?: string | null
        }
        Update: {
          id?: string | null
          order_code?: string | null
          date?: string | null
          warehouse_id?: string | null
          ncc_id?: string | null
          npp_name?: string | null
          vehicle_type?: string | null
          direction?: string | null
          warehouse_type?: string | null
          planned_boxes?: number | null
          planned_pallets?: number | null
          planned_tons?: number | null
          gdo_refs?: string | null
          notes?: string | null
          status?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          priority?: boolean | null
          export_status?: string | null
          material_id?: string | null
          po_number?: string | null
          is_unplanned?: boolean | null
          source_type?: string | null
          transfer_gdo_id?: string | null
          destination_warehouse_id?: string | null
          eta?: string | null
          completed_at?: string | null
          delivery_mode?: string | null
        }
        Relationships: []
      }
      x_bak_plan_dup_20260725: {
        Row: {
          id: string | null
          date: string | null
          warehouse_id: string | null
          warehouse_type: string | null
          vehicle_type: string | null
          ncc_id: string | null
          material_id: string | null
          po_number: string | null
          planned_boxes: number | null
          planned_pallets: number | null
          tms_order_id: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string | null
          updated_at: string | null
          status: string | null
          cancel_reason: string | null
        }
        Insert: {
          id?: string | null
          date?: string | null
          warehouse_id?: string | null
          warehouse_type?: string | null
          vehicle_type?: string | null
          ncc_id?: string | null
          material_id?: string | null
          po_number?: string | null
          planned_boxes?: number | null
          planned_pallets?: number | null
          tms_order_id?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          status?: string | null
          cancel_reason?: string | null
        }
        Update: {
          id?: string | null
          date?: string | null
          warehouse_id?: string | null
          warehouse_type?: string | null
          vehicle_type?: string | null
          ncc_id?: string | null
          material_id?: string | null
          po_number?: string | null
          planned_boxes?: number | null
          planned_pallets?: number | null
          tms_order_id?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          status?: string | null
          cancel_reason?: string | null
        }
        Relationships: []
      }
      x_bak_tmsorder_decimalfix_20260729: {
        Row: {
          id: string | null
          order_code: string | null
          planned_pallets: number | null
          planned_tons: number | null
          backed_at: string | null
        }
        Insert: {
          id?: string | null
          order_code?: string | null
          planned_pallets?: number | null
          planned_tons?: number | null
          backed_at?: string | null
        }
        Update: {
          id?: string | null
          order_code?: string | null
          planned_pallets?: number | null
          planned_tons?: number | null
          backed_at?: string | null
        }
        Relationships: []
      }
      x_bak_tmsorder_status_20260907: {
        Row: {
          id: string | null
          status: string | null
          completed_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string | null
          status?: string | null
          completed_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string | null
          status?: string | null
          completed_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      x_flip_bak_adjustment_log: {
        Row: {
          id: string | null
          delta: number | null
          cartons_before: number | null
          cartons_after: number | null
        }
        Insert: {
          id?: string | null
          delta?: number | null
          cartons_before?: number | null
          cartons_after?: number | null
        }
        Update: {
          id?: string | null
          delta?: number | null
          cartons_before?: number | null
          cartons_after?: number | null
        }
        Relationships: []
      }
      x_flip_bak_inbound_plan_lines: {
        Row: {
          id: string | null
          planned_boxes: number | null
        }
        Insert: {
          id?: string | null
          planned_boxes?: number | null
        }
        Update: {
          id?: string | null
          planned_boxes?: number | null
        }
        Relationships: []
      }
      x_flip_bak_inventory_entry: {
        Row: {
          id: string | null
          cartons_imported: number | null
          cartons_remaining: number | null
          cartons_reserved: number | null
          adjustment_qty: number | null
        }
        Insert: {
          id?: string | null
          cartons_imported?: number | null
          cartons_remaining?: number | null
          cartons_reserved?: number | null
          adjustment_qty?: number | null
        }
        Update: {
          id?: string | null
          cartons_imported?: number | null
          cartons_remaining?: number | null
          cartons_reserved?: number | null
          adjustment_qty?: number | null
        }
        Relationships: []
      }
      x_flip_bak_outbound_item: {
        Row: {
          id: string | null
          cartons_ordered: number | null
          cartons_scanned: number | null
          loose_picking: number | null
        }
        Insert: {
          id?: string | null
          cartons_ordered?: number | null
          cartons_scanned?: number | null
          loose_picking?: number | null
        }
        Update: {
          id?: string | null
          cartons_ordered?: number | null
          cartons_scanned?: number | null
          loose_picking?: number | null
        }
        Relationships: []
      }
      x_flip_bak_outbound_scan_entry: {
        Row: {
          id: string | null
          cartons_scanned: number | null
        }
        Insert: {
          id?: string | null
          cartons_scanned?: number | null
        }
        Update: {
          id?: string | null
          cartons_scanned?: number | null
        }
        Relationships: []
      }
      x_flip_bak_production_import: {
        Row: {
          id: string | null
          planned_cartons: number | null
          posm_cartons: number | null
        }
        Insert: {
          id?: string | null
          planned_cartons?: number | null
          posm_cartons?: number | null
        }
        Update: {
          id?: string | null
          planned_cartons?: number | null
          posm_cartons?: number | null
        }
        Relationships: []
      }
      x_seed_manifest: {
        Row: {
          tbl: string
          id: string
          day: string | null
        }
        Insert: {
          tbl: string
          id: string
          day?: string | null
        }
        Update: {
          tbl?: string
          id?: string
          day?: string | null
        }
        Relationships: []
      }
    }
    Views: {
    }
    Functions: {
      adjust_inventory_atomic: {
        Args: { p_entry_id: string | null; p_delta: number | null; p_note: string | null; p_actor_name: string | null; p_actor_id: string | null; p_stocktake_by: string | null; p_now: string | null; p_vn_date: string | null; p_updated_by: string | null }
        Returns: string
      }
      admin_login_ip_pairs: {
        Args: { p_emails: unknown | null; p_memory: string | null; p_recent: string | null }
        Returns: Record<string, unknown>[]
      }
      alerts_expiry_candidates: {
        Args: { p_days?: number | null }
        Returns: Json
      }
      alerts_packing_unreceived: {
        Args: { p_hours?: number | null; p_window_days?: number | null }
        Returns: Record<string, unknown>[]
      }
      auth_throttle: {
        Args: { p_keys: unknown | null; p_limits: unknown | null; p_event: string | null; p_window_seconds: number | null; p_lock_seconds: number | null; p_email: string | null; p_ip: string | null; p_reason: string | null; p_employee_id: string | null }
        Returns: Json
      }
      book_vehicle_slot: {
        Args: { p_vslot_id: string | null; p_new_slot_id: string | null; p_plate: string | null; p_status: string | null; p_actor: string | null }
        Returns: string
      }
      booking_sequence: {
        Args: { p_warehouse_ids: unknown | null; p_from: string | null; p_to: string | null }
        Returns: Json
      }
      cache_fetch: {
        Args: { p_key: string | null; p_ttl_seconds: number | null }
        Returns: Record<string, unknown>[]
      }
      cache_key_part: {
        Args: { p_arr: unknown | null }
        Returns: string
      }
      cache_store: {
        Args: { p_key: string | null; p_payload: Json | null }
        Returns: undefined
      }
      control_tower_resources: {
        Args: { p_warehouse_ids?: unknown | null; p_today?: string | null }
        Returns: Json
      }
      control_tower_resources_cached: {
        Args: { p_warehouse_ids: unknown | null; p_today: string | null; p_ttl_seconds?: number | null }
        Returns: Json
      }
      control_tower_stats: {
        Args: { p_warehouse_ids?: unknown | null; p_categories?: unknown | null; p_today?: string | null; p_material_codes?: unknown | null }
        Returns: Json
      }
      control_tower_stats_cached: {
        Args: { p_warehouse_ids: unknown | null; p_categories: unknown | null; p_today: string | null; p_material_codes: unknown | null; p_ttl_seconds?: number | null }
        Returns: Json
      }
      control_tower_stats_stale: {
        Args: { p_warehouse_ids: unknown | null; p_categories: unknown | null; p_today: string | null; p_material_codes: unknown | null }
        Returns: Json
      }
      customer_page: {
        Args: { p_search?: string | null; p_channels?: unknown | null; p_has_channel?: boolean | null; p_warehouse_id?: string | null; p_active?: boolean | null; p_has_rule?: boolean | null; p_limit?: number | null; p_offset?: number | null }
        Returns: Json
      }
      customer_seed_candidates: {
        Args: { p_days?: number | null }
        Returns: Json
      }
      customer_set_dispatch_vehicles: {
        Args: { p_ids: unknown | null; p_key: string | null; p_mode: string | null; p_models: unknown | null; p_by: string | null }
        Returns: number
      }
      customer_set_load_mode_cat: {
        Args: { p_ids: unknown | null; p_category: string | null; p_mode: string | null; p_by: string | null }
        Returns: number
      }
      cycle_count_info: {
        Args: { p_warehouse_id: string | null }
        Returns: Json
      }
      dashboard_all: {
        Args: { p_warehouse_ids: unknown | null; p_categories: unknown | null; p_today: string | null }
        Returns: Json
      }
      dashboard_all_cached: {
        Args: { p_warehouse_ids: unknown | null; p_categories: unknown | null; p_today: string | null; p_ttl_seconds?: number | null }
        Returns: Json
      }
      dashboard_stats: {
        Args: { p_warehouse_ids?: unknown | null; p_categories?: unknown | null; p_today?: string | null }
        Returns: Json
      }
      date_rule_categories: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      date_rule_master_value_ok: {
        Args: { p: Json | null }
        Returns: boolean
      }
      date_rule_valid: {
        Args: { p: Json | null }
        Returns: boolean
      }
      directed_board: {
        Args: { p_warehouse_id: string | null; p_mode: string | null; p_gdo_id?: string | null; p_driver_id?: string | null }
        Returns: Json
      }
      directed_supervision: {
        Args: { p_warehouse_id: string | null; p_days?: number | null }
        Returns: Json
      }
      dispatch_customer_rank: {
        Args: { p_plant: string | null; p_from: string | null; p_to: string | null }
        Returns: Json
      }
      dispatch_decisions: {
        Args: { p_warehouse_id: string | null }
        Returns: Json
      }
      dispatch_inputs_stamp: {
        Args: { p_warehouse_id: string | null }
        Returns: string
      }
      dispatch_marked_counts: {
        Args: { p_warehouse_id: string | null; p_plant: string | null; p_day: string | null; p_slocs: unknown | null; p_flows: unknown | null; p_segment?: string | null }
        Returns: Record<string, unknown>[]
      }
      dispatch_marked_ods: {
        Args: { p_warehouse_id: string | null; p_plant: string | null; p_day: string | null; p_slocs: unknown | null; p_flows: unknown | null; p_segment?: string | null; p_kind?: string | null; p_search?: string | null }
        Returns: Record<string, unknown>[]
      }
      dispatch_new_ods: {
        Args: { p_plant: string | null; p_from: string | null; p_to: string | null; p_day: string | null; p_slocs: unknown | null; p_warehouse_id: string | null; p_plan_id: string | null; p_segment: string | null }
        Returns: unknown
      }
      dispatch_plan_stamp: {
        Args: { p_plan_id: string | null }
        Returns: Json
      }
      dispatch_planned_ods: {
        Args: { p_plant: string | null; p_day: string | null; p_limit: number | null }
        Returns: unknown
      }
      dispatch_pool_rows: {
        Args: { p_plant: string | null; p_day: string | null; p_warehouse_id?: string | null; p_flows?: unknown | null }
        Returns: unknown[]
      }
      dispatch_stock_conditions: {
        Args: { p_warehouse_id: string | null; p_material_codes: unknown | null }
        Returns: Json
      }
      erp_in_khvc_mismatch: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      erp_in_khvc_of: {
        Args: { p_od: string | null }
        Returns: boolean
      }
      erp_so_lines_summary: {
        Args: { p_from: string | null; p_to: string | null; p_plants?: unknown | null; p_status?: unknown | null; p_flows?: unknown | null; p_q?: string | null }
        Returns: Json
      }
      fill_candidates: {
        Args: { p_wh_scope: unknown | null; p_warehouse_id: string | null; p_material_id: string | null; p_limit?: number | null }
        Returns: Json
      }
      fill_close_reason: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      fill_demand: {
        Args: { p_wh_scope: unknown | null; p_cat_scope: unknown | null; p_warehouse_id: string | null; p_date: string | null; p_max_sugg?: number | null }
        Returns: Json
      }
      fill_order_close: {
        Args: { p_order_id: string | null; p_actor: string | null; p_now: string | null }
        Returns: Json
      }
      fill_order_ensure: {
        Args: { p_id: string | null; p_warehouse_id: string | null; p_target_date: string | null; p_type: string | null; p_order_code: string | null; p_auto: boolean | null; p_actor: string | null; p_now: string | null }
        Returns: Json
      }
      fill_order_rollup: {
        Args: { p_order_id: string | null; p_now?: string | null }
        Returns: string
      }
      fill_orders_page: {
        Args: { p_wh_scope: unknown | null; p_warehouse_id: string | null; p_from: string | null; p_to: string | null; p_status: unknown | null; p_assignee: string | null; p_search: string | null; p_offset: number | null; p_limit: number | null }
        Returns: Json
      }
      fill_reconcile_enqueue: {
        Args: { p_wh: string | null; p_date: string | null }
        Returns: undefined
      }
      fill_reconcile_lease: {
        Args: { p_wh: string | null; p_lease_s?: number | null }
        Returns: boolean
      }
      fill_reconcile_release: {
        Args: { p_wh: string | null }
        Returns: undefined
      }
      fill_reconcile_take: {
        Args: { p_wh: string | null; p_today: string | null; p_sweep_s?: number | null; p_lease_s?: number | null; p_quiet_s?: number | null }
        Returns: Json
      }
      fill_report: {
        Args: { p_wh_scope: unknown | null; p_warehouse_id: string | null; p_from: string | null; p_to: string | null }
        Returns: Json
      }
      fill_scan_apply: {
        Args: { p_task_id: string | null; p_entry_id: string | null; p_to_location_id: string | null; p_actor_id: string | null; p_actor_name: string | null; p_take_over: boolean | null; p_update_date: string | null; p_now: string | null }
        Returns: Json
      }
      fill_task_reduce: {
        Args: { p_task_id: string | null; p_target_qty: number | null; p_reason: string | null; p_now: string | null }
        Returns: Json
      }
      fill_task_topup: {
        Args: { p_warehouse_id: string | null; p_target_date: string | null; p_material_id: string | null; p_required_date: string | null; p_add_qty: number | null; p_add_pallets: number | null; p_now: string | null }
        Returns: Json
      }
      forklift_report: {
        Args: { p_from: string | null; p_to: string | null; p_warehouse_ids?: unknown | null }
        Returns: Json
      }
      function_overloads: {
        Args: Record<PropertyKey, never>
        Returns: Record<string, unknown>[]
      }
      gate_leaves_page: {
        Args: { p_offset: number | null; p_limit: number | null; p_date_from: string | null; p_date_to: string | null; p_warehouse_id?: string | null; p_warehouse_type?: string | null; p_vehicle_types?: unknown | null; p_company_id?: string | null; p_direction?: string | null; p_status?: string | null; p_scope_wh?: unknown | null; p_categories?: unknown | null; p_wh_order?: unknown | null; p_wt_order?: unknown | null; p_vt_order?: unknown | null; p_collapsed_wh?: unknown | null; p_collapsed_wt?: unknown | null; p_collapsed_vt?: unknown | null; p_wt_null?: string | null; p_vt_null?: string | null }
        Returns: Json
      }
      gate_tree: {
        Args: { p_date_from: string | null; p_date_to: string | null; p_warehouse_id?: string | null; p_warehouse_type?: string | null; p_vehicle_types?: unknown | null; p_company_id?: string | null; p_direction?: string | null; p_status?: string | null; p_scope_wh?: unknown | null; p_categories?: unknown | null }
        Returns: Json
      }
      gdo_assign_dock: {
        Args: { p_gdo_id: string | null; p_dock_id: string | null; p_plate: string | null; p_actor: string | null }
        Returns: Json
      }
      gdo_holds_dock: {
        Args: { p_status: string | null; p_dock_assigned_at: string | null }
        Returns: boolean
      }
      gdo_status_label: {
        Args: { p_status: string | null; p_assigned_at: string | null }
        Returns: string
      }
      gdo_weight_estimates: {
        Args: { p_gdo_ids: unknown | null }
        Returns: Json
      }
      get_outbound_scan_log: {
        Args: { p_from_date?: string | null; p_to_date?: string | null; p_warehouse_ids?: string | null; p_material_category?: string | null; p_group_code?: string | null; p_distributor?: string | null; p_delivery_code?: string | null; p_pallet_code?: string | null; p_material?: string | null; p_machine_codes?: string | null; p_cycles?: string | null; p_scanner_name?: string | null; p_nmsx?: string | null; p_limit?: number | null; p_offset?: number | null; p_allowed_categories?: string | null; p_rotation?: string | null }
        Returns: Record<string, unknown>[]
      }
      get_scan_log_facets: {
        Args: { p_material_category?: string | null; p_warehouse_ids?: string | null; p_allowed_categories?: string | null }
        Returns: Record<string, unknown>[]
      }
      gin_extract_query_trgm: {
        Args: { arg1: string | null; arg2: unknown | null; arg3: number | null; arg4: unknown | null; arg5: unknown | null; arg6: unknown | null; arg7: unknown | null }
        Returns: unknown
      }
      gin_extract_value_trgm: {
        Args: { arg1: string | null; arg2: unknown | null }
        Returns: unknown
      }
      gin_trgm_consistent: {
        Args: { arg1: unknown | null; arg2: number | null; arg3: string | null; arg4: number | null; arg5: unknown | null; arg6: unknown | null; arg7: unknown | null; arg8: unknown | null }
        Returns: boolean
      }
      gin_trgm_triconsistent: {
        Args: { arg1: unknown | null; arg2: number | null; arg3: string | null; arg4: number | null; arg5: unknown | null; arg6: unknown | null; arg7: unknown | null }
        Returns: string
      }
      gtrgm_compress: {
        Args: { arg1: unknown | null }
        Returns: unknown
      }
      gtrgm_consistent: {
        Args: { arg1: unknown | null; arg2: string | null; arg3: number | null; arg4: number | null; arg5: unknown | null }
        Returns: boolean
      }
      gtrgm_decompress: {
        Args: { arg1: unknown | null }
        Returns: unknown
      }
      gtrgm_distance: {
        Args: { arg1: unknown | null; arg2: string | null; arg3: number | null; arg4: number | null; arg5: unknown | null }
        Returns: number
      }
      gtrgm_in: {
        Args: { arg1: unknown | null }
        Returns: unknown
      }
      gtrgm_options: {
        Args: { arg1: unknown | null }
        Returns: undefined
      }
      gtrgm_out: {
        Args: { arg1: unknown | null }
        Returns: unknown
      }
      gtrgm_penalty: {
        Args: { arg1: unknown | null; arg2: unknown | null; arg3: unknown | null }
        Returns: unknown
      }
      gtrgm_picksplit: {
        Args: { arg1: unknown | null; arg2: unknown | null }
        Returns: unknown
      }
      gtrgm_same: {
        Args: { arg1: unknown | null; arg2: unknown | null; arg3: unknown | null }
        Returns: unknown
      }
      gtrgm_union: {
        Args: { arg1: unknown | null; arg2: unknown | null }
        Returns: unknown
      }
      hr_attendance_matrix: {
        Args: { p_scope_ids: unknown | null; p_wh: string | null; p_dept: string | null; p_jt_name: string | null; p_search: string | null; p_from: string | null; p_to: string | null; p_work_dates: unknown | null; p_status: string | null; p_offset: number | null; p_limit: number | null }
        Returns: Json
      }
      hr_employees_page: {
        Args: { p_scope_ids: unknown | null; p_dept: string | null; p_jt_id: string | null; p_wh: string | null; p_search: string | null; p_active: string | null; p_incl_deleted: boolean | null; p_status: string | null; p_offset: number | null; p_limit: number | null }
        Returns: Json
      }
      hr_leaves_page: {
        Args: { p_scope_emp_ids: unknown | null; p_warehouse: string | null; p_dept: string | null; p_employee: string | null; p_jt_name: string | null; p_status: string | null; p_from: string | null; p_to: string | null; p_offset: number | null; p_limit: number | null }
        Returns: Json
      }
      immutable_unaccent: {
        Args: { arg1: string | null }
        Returns: string
      }
      inbound_orders_facets: {
        Args: { p_warehouse_ids?: unknown | null; p_scope_categories?: unknown | null; p_category?: string | null; p_status?: string | null; p_date_from?: string | null; p_date_to?: string | null }
        Returns: Json
      }
      inbound_orders_page: {
        Args: { p_offset: number | null; p_limit: number | null; p_warehouse_ids?: unknown | null; p_scope_categories?: unknown | null; p_category?: string | null; p_status?: string | null; p_date_from?: string | null; p_date_to?: string | null; p_material_ids?: unknown | null; p_cycles?: unknown | null; p_machines?: unknown | null; p_shift_ids?: unknown | null; p_source_types?: unknown | null; p_importer_ids?: unknown | null; p_search?: string | null; p_search_mat_ids?: unknown | null; p_search_order_ids?: unknown | null }
        Returns: Json
      }
      inbound_orders_summary: {
        Args: { p_warehouse_ids?: unknown | null; p_scope_categories?: unknown | null; p_category?: string | null; p_status?: string | null; p_date_from?: string | null; p_date_to?: string | null; p_material_ids?: unknown | null; p_cycles?: unknown | null; p_machines?: unknown | null; p_shift_ids?: unknown | null; p_source_types?: unknown | null; p_importer_ids?: unknown | null; p_search?: string | null; p_search_mat_ids?: unknown | null; p_search_order_ids?: unknown | null }
        Returns: Json
      }
      inventory_band_totals: {
        Args: { p_ids: unknown | null; p_status: string | null; p_wh_ids: unknown | null; p_location_ids: unknown | null; p_material_ids: unknown | null; p_categories: unknown | null; p_qa_ids: unknown | null; p_search: string | null; p_search_mat_ids: unknown | null; p_search_loc_ids: unknown | null; p_manufacturer: string | null; p_cycles: unknown | null; p_machines: unknown | null; p_nmsx: unknown | null; p_ncc_ids: unknown | null; p_import_from: string | null; p_import_to: string | null }
        Returns: Json
      }
      inventory_facet_values: {
        Args: { p_warehouse_ids?: unknown | null; p_categories?: unknown | null }
        Returns: Record<string, unknown>[]
      }
      inventory_summary_page: {
        Args: { p_ids: unknown | null; p_status: string | null; p_wh_ids: unknown | null; p_location_ids: unknown | null; p_material_ids: unknown | null; p_categories: unknown | null; p_qa_ids: unknown | null; p_search: string | null; p_search_mat_ids: unknown | null; p_search_loc_ids: unknown | null; p_manufacturer: string | null; p_cycles: unknown | null; p_machines: unknown | null; p_nmsx: unknown | null; p_ncc_ids: unknown | null; p_import_from: string | null; p_import_to: string | null; p_offset: number | null; p_limit: number | null }
        Returns: Json
      }
      like_esc: {
        Args: { p: string | null }
        Returns: string
      }
      locations_page: {
        Args: { p_offset: number | null; p_limit: number | null; p_wh_ids?: unknown | null; p_category?: string | null; p_scope_cats?: unknown | null; p_tokens?: unknown | null; p_flag?: boolean | null; p_incl_inactive?: boolean | null; p_with_rows?: boolean | null; p_pick_face?: boolean | null; p_subs?: unknown | null; p_slot_no_in?: boolean | null; p_slot_no_out?: boolean | null }
        Returns: Json
      }
      locations_summary: {
        Args: { p_wh_ids?: unknown | null; p_category?: string | null; p_scope_cats?: unknown | null; p_tokens?: unknown | null; p_flag?: boolean | null; p_pick_face?: boolean | null; p_subs?: unknown | null; p_slot_no_in?: boolean | null; p_slot_no_out?: boolean | null }
        Returns: Json
      }
      loose_picking_facets: {
        Args: { p_wh_scope: unknown | null; p_cat_scope: unknown | null; p_warehouse_id: string | null; p_from: string | null; p_to: string | null }
        Returns: Json
      }
      loose_picking_page: {
        Args: { p_wh_scope: unknown | null; p_cat_scope: unknown | null; p_warehouse_id: string | null; p_from: string | null; p_to: string | null; p_wh_types: unknown | null; p_export_types: unknown | null; p_dvvts: unknown | null; p_npps: unknown | null; p_search: string | null; p_offset: number | null; p_limit: number | null }
        Returns: Json
      }
      lot_trace: {
        Args: { p_kind: string | null; p_value?: string | null; p_prod_from?: string | null; p_prod_to?: string | null; p_ship_from?: string | null; p_ship_to?: string | null; p_wh_ids?: unknown | null; p_categories?: unknown | null; p_limit?: number | null; p_codes?: unknown | null; p_cycle?: string | null; p_machine?: string | null; p_nmsx?: string | null; p_pallet?: string | null; p_material?: string | null; p_batch?: string | null; p_npp?: string | null; p_trip?: string | null; p_plate?: string | null }
        Returns: Json
      }
      material_abc: {
        Args: { p_warehouse_id: string | null; p_categories?: unknown | null; p_days?: number | null }
        Returns: Record<string, unknown>[]
      }
      material_categories: {
        Args: Record<PropertyKey, never>
        Returns: Record<string, unknown>[]
      }
      materials_page: {
        Args: { p_offset: number | null; p_limit: number | null; p_tokens?: unknown | null; p_categories?: unknown | null; p_scope_cats?: unknown | null; p_status?: unknown | null; p_qr?: unknown | null; p_dq?: unknown | null; p_cat_rules?: Json | null; p_legacy_no_sl?: unknown | null; p_legacy_pe?: unknown | null; p_dims?: unknown | null; p_flags?: unknown | null }
        Returns: Json
      }
      materials_summary: {
        Args: { p_tokens?: unknown | null; p_categories?: unknown | null; p_scope_cats?: unknown | null; p_status?: unknown | null; p_qr?: unknown | null; p_dq?: unknown | null; p_cat_rules?: Json | null; p_legacy_no_sl?: unknown | null; p_legacy_pe?: unknown | null; p_dims?: unknown | null; p_flags?: unknown | null }
        Returns: Json
      }
      move_pallets_to_location: {
        Args: { p_ids: unknown | null; p_location_id: string | null; p_updated_by: string | null; p_update_date: string | null; p_now: string | null; p_max_materials?: number | null; p_putaway_checked?: boolean | null; p_putaway_violation?: string | null; p_putaway_override_reason?: string | null }
        Returns: string
      }
      od_family: {
        Args: { p_od: string | null }
        Returns: unknown
      }
      omni_location_ids: {
        Args: { term: string | null }
        Returns: Record<string, unknown>[]
      }
      omni_material_ids: {
        Args: { term: string | null }
        Returns: Record<string, unknown>[]
      }
      omni_narrow_import_material_ids: {
        Args: { p_ids: unknown | null }
        Returns: Record<string, unknown>[]
      }
      omni_narrow_location_ids: {
        Args: { p_ids: unknown | null }
        Returns: Record<string, unknown>[]
      }
      omni_narrow_material_ids: {
        Args: { p_ids: unknown | null }
        Returns: Record<string, unknown>[]
      }
      outbound_adjust_entry: {
        Args: { p_entry_id: string | null; p_delta_remaining: number | null; p_delta_reserved: number | null; p_now: string | null }
        Returns: Json
      }
      outbound_claim_quota: {
        Args: { p_item_id: string | null; p_want: number | null; p_ceiling: number | null; p_complete_when_full: boolean | null; p_now: string | null }
        Returns: Json
      }
      outbound_consume_exact: {
        Args: { p_entry_id: string | null; p_amount: number | null; p_now: string | null }
        Returns: Json
      }
      outbound_date_rule_lines: {
        Args: { p_from: string | null; p_to: string | null; p_scope_wh?: unknown | null; p_warehouse_id?: string | null; p_categories?: unknown | null; p_state?: string | null; p_search?: string | null; p_limit?: number | null; p_offset?: number | null; p_source?: unknown | null; p_mat_categories?: unknown | null; p_kinds?: unknown | null; p_shiptos?: unknown | null }
        Returns: Json
      }
      outbound_gdos_facets: {
        Args: { p_warehouse_ids?: unknown | null; p_scope_categories?: unknown | null; p_date_from?: string | null; p_date_to?: string | null }
        Returns: Json
      }
      outbound_gdos_page: {
        Args: { p_offset: number | null; p_limit: number | null; p_warehouse_ids?: unknown | null; p_scope_categories?: unknown | null; p_warehouse_types?: unknown | null; p_status?: string | null; p_transfer_status?: string | null; p_date_from?: string | null; p_date_to?: string | null; p_export_types?: unknown | null; p_dvvts?: unknown | null; p_npps?: unknown | null; p_material_codes?: unknown | null; p_status_labels?: unknown | null; p_search?: string | null; p_search_gdo_ids?: unknown | null }
        Returns: Json
      }
      outbound_gdos_summary: {
        Args: { p_warehouse_ids?: unknown | null; p_scope_categories?: unknown | null; p_warehouse_types?: unknown | null; p_status?: string | null; p_transfer_status?: string | null; p_date_from?: string | null; p_date_to?: string | null; p_export_types?: unknown | null; p_dvvts?: unknown | null; p_npps?: unknown | null; p_material_codes?: unknown | null; p_status_labels?: unknown | null; p_search?: string | null; p_search_gdo_ids?: unknown | null }
        Returns: Json
      }
      outbound_pool_apply: {
        Args: { p_item_id: string | null; p_material_code: string | null; p_warehouse_id: string | null; p_mode: string | null; p_new_qty: number | null; p_item_status: string | null; p_chosen_date?: string | null; p_claim_only_pending?: boolean | null; p_touch_pool?: boolean | null }
        Returns: Json
      }
      outbound_shortage_stats: {
        Args: { p_warehouse_id: string | null; p_date: string | null }
        Returns: Record<string, unknown>[]
      }
      packing_logs_recon: {
        Args: { p_status?: string | null; p_wh?: string | null; p_scope?: unknown | null; p_from?: string | null; p_to?: string | null; p_machine?: string | null; p_cycle?: string | null; p_search?: string | null; p_received?: string | null; p_page?: number | null; p_size?: number | null }
        Returns: Json
      }
      packing_open_run: {
        Args: { p: Json | null }
        Returns: Json
      }
      packing_runs_received: {
        Args: { p_run_ids: unknown | null }
        Returns: Record<string, unknown>[]
      }
      pallet_ledger: {
        Args: { p_pallet_code: string | null; p_warehouse_ids?: unknown | null; p_limit?: number | null }
        Returns: Json
      }
      pallet_op_material_code: {
        Args: { p_target: unknown | null; p_source: unknown | null }
        Returns: string
      }
      pallet_ops_page: {
        Args: { p_wh: string | null; p_type: string | null; p_category: string | null; p_search: string | null; p_from: string | null; p_to: string | null; p_offset: number | null; p_limit: number | null }
        Returns: Json
      }
      pallet_prints_facets: {
        Args: { p_wh_scope: unknown | null; p_cat_scope: unknown | null; p_from: string | null; p_to: string | null; p_search: string | null }
        Returns: Json
      }
      pallet_prints_page: {
        Args: { p_wh_scope: unknown | null; p_cat_scope: unknown | null; p_from: string | null; p_to: string | null; p_search: string | null; p_modes: unknown | null; p_materials: unknown | null; p_cycles: unknown | null; p_machines: unknown | null; p_printers: unknown | null; p_offset: number | null; p_limit: number | null }
        Returns: Json
      }
      putaway_slot_facts: {
        Args: { p_loc_ids: unknown | null; p_material_id?: string | null; p_with_lots?: boolean | null; p_with_mats?: boolean | null }
        Returns: Record<string, unknown>[]
      }
      qa_is_hold: {
        Args: { p_qa_status_id: string | null }
        Returns: boolean
      }
      qty_entry_decimal: {
        Args: { p_qty: number | null; p_entry_unit: string | null; p_upc: number | null }
        Returns: number
      }
      realtime_readiness: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      recount_slot: {
        Args: { p_slot_id: string | null }
        Returns: undefined
      }
      rename_warehouse_type: {
        Args: { p_old: string | null; p_new: string | null }
        Returns: Json
      }
      rest_exposure: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      rls_gap_tables: {
        Args: Record<PropertyKey, never>
        Returns: unknown
      }
      rpc_source: {
        Args: { p_name: string | null }
        Returns: string
      }
      scan_insert_pallet: {
        Args: { p_entry: Json | null; p_location_id: string | null; p_stack_layer: number | null; p_max_materials?: number | null }
        Returns: string
      }
      search_outbound_scan_log: {
        Args: { p_q: string | null; p_warehouse_ids?: string | null; p_allowed_categories?: string | null; p_limit?: number | null; p_offset?: number | null }
        Returns: Record<string, unknown>[]
      }
      secdef_public_grants: {
        Args: Record<PropertyKey, never>
        Returns: Record<string, unknown>[]
      }
      service_level: {
        Args: { p_from: string | null; p_to: string | null; p_wh_ids?: unknown | null; p_limit?: number | null }
        Returns: Json
      }
      set_limit: {
        Args: { arg1: number | null }
        Returns: number
      }
      show_limit: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      show_trgm: {
        Args: { arg1: string | null }
        Returns: unknown
      }
      similarity: {
        Args: { arg1: string | null; arg2: string | null }
        Returns: number
      }
      similarity_dist: {
        Args: { arg1: string | null; arg2: string | null }
        Returns: number
      }
      similarity_op: {
        Args: { arg1: string | null; arg2: string | null }
        Returns: boolean
      }
      slotting_stats: {
        Args: { p_warehouse_id: string | null; p_categories?: unknown | null; p_days?: number | null }
        Returns: Json
      }
      slotting_stats_cached: {
        Args: { p_warehouse_id: string | null; p_categories: unknown | null; p_days: number | null; p_ttl_seconds?: number | null }
        Returns: Json
      }
      stocktake_entries_page: {
        Args: { p_loc_ids: unknown | null; p_from: string | null; p_to: string | null; p_view: string | null; p_offset: number | null; p_limit: number | null }
        Returns: Json
      }
      stocktake_log_page: {
        Args: { p_wh_ids: unknown | null; p_loc_ids: unknown | null; p_category: string | null; p_scope_cats: unknown | null; p_search: string | null; p_from: string | null; p_to: string | null; p_offset: number | null; p_limit: number | null }
        Returns: Json
      }
      strict_word_similarity: {
        Args: { arg1: string | null; arg2: string | null }
        Returns: number
      }
      strict_word_similarity_commutator_op: {
        Args: { arg1: string | null; arg2: string | null }
        Returns: boolean
      }
      strict_word_similarity_dist_commutator_op: {
        Args: { arg1: string | null; arg2: string | null }
        Returns: number
      }
      strict_word_similarity_dist_op: {
        Args: { arg1: string | null; arg2: string | null }
        Returns: number
      }
      strict_word_similarity_op: {
        Args: { arg1: string | null; arg2: string | null }
        Returns: boolean
      }
      tms_orders_facets: {
        Args: { p_date_from: string | null; p_date_to: string | null; p_warehouse_id?: string | null; p_ncc_user?: string | null; p_categories?: unknown | null; p_scope_wh?: unknown | null }
        Returns: Json
      }
      tms_orders_page: {
        Args: { p_offset: number | null; p_limit: number | null; p_date_from: string | null; p_date_to: string | null; p_warehouse_id?: string | null; p_ncc_user?: string | null; p_categories?: unknown | null; p_scope_wh?: unknown | null; p_directions?: unknown | null; p_dvvt?: unknown | null; p_wh_types?: unknown | null; p_vehicle_types?: unknown | null; p_slot_ids?: unknown | null; p_unbooked?: boolean | null; p_with_stt?: boolean | null; p_search?: string | null }
        Returns: Json
      }
      tms_orders_summary: {
        Args: { p_date_from: string | null; p_date_to: string | null; p_warehouse_id?: string | null; p_ncc_user?: string | null; p_categories?: unknown | null; p_scope_wh?: unknown | null; p_directions?: unknown | null; p_dvvt?: unknown | null; p_wh_types?: unknown | null; p_vehicle_types?: unknown | null; p_slot_ids?: unknown | null; p_unbooked?: boolean | null; p_search?: string | null }
        Returns: Json
      }
      tms_vehicles_page: {
        Args: { p_ncc_ids: unknown | null; p_vt_ids: unknown | null; p_active: boolean | null; p_search: string | null; p_offset: number | null; p_limit: number | null }
        Returns: Json
      }
      trace_suggest: {
        Args: { p_kind: string | null; p_search?: string | null; p_limit?: number | null }
        Returns: Json
      }
      transfer_plan_lines_replace: {
        Args: { p_order_id: string | null; p_rows: Json | null }
        Returns: number
      }
      try_book_slot: {
        Args: { p_slot_id: string | null; p_delta: number | null }
        Returns: boolean
      }
      unaccent: {
        Args: { arg1: string | null } | { arg1: unknown | null; arg2: string | null }
        Returns: string
      }
      unaccent_init: {
        Args: { arg1: unknown | null }
        Returns: unknown
      }
      unaccent_lexize: {
        Args: { arg1: unknown | null; arg2: unknown | null; arg3: unknown | null; arg4: unknown | null }
        Returns: unknown
      }
      warehouse_cost_vouchers: {
        Args: { p_from: string | null; p_to: string | null; p_wh_ids?: unknown | null; p_warehouse_id?: string | null; p_search?: string | null; p_page?: number | null; p_page_size?: number | null }
        Returns: Json
      }
      warehouse_docks_status: {
        Args: { p_warehouse_id: string | null }
        Returns: Json
      }
      warehouse_id_uuid_mismatch: {
        Args: Record<PropertyKey, never>
        Returns: Record<string, unknown>[]
      }
      warehouse_kpi: {
        Args: { p_warehouse_ids?: unknown | null; p_categories?: unknown | null; p_from?: string | null; p_to?: string | null; p_std_hours?: number | null; p_pct_low?: number | null; p_slow_days?: number | null; p_dead_days?: number | null; p_skip_snapshot?: boolean | null }
        Returns: Json
      }
      warehouse_kpi_cached: {
        Args: { p_warehouse_ids?: unknown | null; p_categories?: unknown | null; p_from?: string | null; p_to?: string | null; p_std_hours?: number | null; p_pct_low?: number | null; p_slow_days?: number | null; p_dead_days?: number | null; p_ttl_seconds?: number | null; p_skip_snapshot?: boolean | null }
        Returns: Json
      }
      warehouse_kpi_series: {
        Args: { p_warehouse_ids?: unknown | null; p_categories?: unknown | null; p_grain?: string | null; p_from?: string | null; p_to?: string | null; p_std_hours?: number | null; p_pct_low?: number | null; p_slow_days?: number | null; p_dead_days?: number | null; p_ttl_seconds?: number | null }
        Returns: Json
      }
      warehouse_kpi_trend: {
        Args: { p_warehouse_ids?: unknown | null; p_categories?: unknown | null; p_months?: number | null; p_end?: string | null; p_std_hours?: number | null; p_pct_low?: number | null; p_slow_days?: number | null; p_dead_days?: number | null; p_ttl_seconds?: number | null }
        Returns: Json
      }
      warehouse_map_assign_cells: {
        Args: { p_warehouse_id: string | null; p_items: Json | null; p_actor: string | null }
        Returns: Json
      }
      warehouse_map_occupancy: {
        Args: { p_warehouse_id: string | null }
        Returns: Json
      }
      warehouse_productivity: {
        Args: { p_warehouse_ids?: unknown | null; p_categories?: unknown | null; p_from?: string | null; p_to?: string | null; p_std_hours?: number | null }
        Returns: Json
      }
      warehouse_productivity_cached: {
        Args: { p_warehouse_ids?: unknown | null; p_categories?: unknown | null; p_from?: string | null; p_to?: string | null; p_std_hours?: number | null; p_ttl_seconds?: number | null }
        Returns: Json
      }
      warehouse_type_column_coverage: {
        Args: Record<PropertyKey, never>
        Returns: Record<string, unknown>[]
      }
      weigh_ticket_warehouses: {
        Args: Record<PropertyKey, never>
        Returns: Record<string, unknown>[]
      }
      weigh_tickets_page: {
        Args: { p_wh_ids: unknown | null; p_null_ok: boolean | null; p_from: string | null; p_to: string | null; p_direction: string | null; p_match: string | null; p_q: string | null; p_plate: string | null; p_offset: number | null; p_limit: number | null }
        Returns: Json
      }
      word_similarity: {
        Args: { arg1: string | null; arg2: string | null }
        Returns: number
      }
      word_similarity_commutator_op: {
        Args: { arg1: string | null; arg2: string | null }
        Returns: boolean
      }
      word_similarity_dist_commutator_op: {
        Args: { arg1: string | null; arg2: string | null }
        Returns: number
      }
      word_similarity_dist_op: {
        Args: { arg1: string | null; arg2: string | null }
        Returns: number
      }
      word_similarity_op: {
        Args: { arg1: string | null; arg2: string | null }
        Returns: boolean
      }
      work_inbox: {
        Args: { p_warehouse_ids: unknown | null; p_employee_id: string | null }
        Returns: Json
      }
      wt_cats: {
        Args: { p_raw: string | null }
        Returns: unknown
      }
      zone_capacity_rows: {
        Args: { p_wh_ids: unknown | null; p_categories: unknown | null }
        Returns: Record<string, unknown>[]
      }
      zone_used_pallets: {
        Args: { p_wh_ids: unknown | null }
        Returns: Record<string, unknown>[]
      }
      zsd02_coverage: {
        Args: { p_plant: string | null }
        Returns: Json
      }
    }
    Enums: {
    }
    CompositeTypes: Record<string, never>
  }
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T]
