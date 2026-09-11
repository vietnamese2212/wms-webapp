// FILE SINH TỰ ĐỘNG — `node scripts/gen-db-types.mjs` (từ information_schema STAGING). KHÔNG sửa tay.
// Sinh lúc 2026-09-11T07:55:56.005Z · 94 bảng/view · 157 hàm · 0 enum
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
        }
        Insert: {
          id: string
          gdo_id: string
          delivery_code?: string | null
          distributor_name?: string | null
          status?: string
          created_at?: string
          updated_at: string
        }
        Update: {
          id?: string
          gdo_id?: string
          delivery_code?: string | null
          distributor_name?: string | null
          status?: string
          created_at?: string
          updated_at?: string
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
        Args: { p_delta: unknown; p_actor_name: unknown; p_stocktake_by: unknown; p_vn_date: unknown; arg10: unknown; arg12: unknown; arg14: unknown; arg16: unknown; arg18: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown }
        Returns: string
      }
      alerts_expiry_candidates: {
        Args: { arg2?: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown }
        Returns: Json
      }
      alerts_packing_unreceived: {
        Args: { p_window_days?: unknown; n?: unknown }
        Returns: Record<string, unknown>[]
      }
      auth_throttle: {
        Args: { p_limits: unknown; p_window_seconds: unknown; p_email: unknown; p_reason: unknown; arg10: unknown; arg12: unknown; arg14: unknown; arg16: unknown; arg18: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown }
        Returns: Json
      }
      book_vehicle_slot: {
        Args: { p_new_slot_id: unknown; p_status: unknown; arg6: unknown; arg8: unknown; arg10: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown }
        Returns: string
      }
      booking_sequence: {
        Args: { p_from: unknown; arg4: unknown; arg6: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown }
        Returns: Json
      }
      cache_fetch: {
        Args: { p_ttl_seconds: unknown; fresh: unknown }
        Returns: Record<string, unknown>[]
      }
      cache_key_part: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown; arg7?: unknown }
        Returns: string
      }
      cache_store: {
        Args: { p_payload: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown }
        Returns: undefined
      }
      control_tower_resources: {
        Args: { p_today?: unknown; arg4?: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown }
        Returns: Json
      }
      control_tower_resources_cached: {
        Args: { p_today: unknown; arg4: unknown; arg6?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown }
        Returns: Json
      }
      control_tower_stats: {
        Args: { p_categories?: unknown; p_material_codes?: unknown; arg6?: unknown; arg8?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown }
        Returns: Json
      }
      control_tower_stats_cached: {
        Args: { p_categories: unknown; p_material_codes: unknown; arg6: unknown; arg8: unknown; arg10?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown }
        Returns: Json
      }
      control_tower_stats_stale: {
        Args: { p_categories: unknown; p_material_codes: unknown; arg6: unknown; arg8: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown }
        Returns: Json
      }
      customer_page: {
        Args: { p_channels?: unknown; p_warehouse_id?: unknown; p_has_rule?: unknown; p_offset?: unknown; arg10?: unknown; arg12?: unknown; arg14?: unknown; arg16?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown }
        Returns: Json
      }
      customer_seed_candidates: {
        Args: { arg2?: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown }
        Returns: Json
      }
      cycle_count_info: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown }
        Returns: Json
      }
      dashboard_all: {
        Args: { p_categories: unknown; arg4: unknown; arg6: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown }
        Returns: Json
      }
      dashboard_all_cached: {
        Args: { p_categories: unknown; p_ttl_seconds: unknown; arg6: unknown; arg8?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown }
        Returns: Json
      }
      dashboard_stats: {
        Args: { p_categories?: unknown; arg4?: unknown; arg6?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown }
        Returns: Json
      }
      date_rule_categories: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      date_rule_master_value_ok: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown; arg7?: unknown }
        Returns: boolean
      }
      date_rule_valid: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown; arg7?: unknown }
        Returns: boolean
      }
      directed_board: {
        Args: { p_mode: unknown; p_driver_id: unknown; arg6?: unknown; arg8?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown }
        Returns: Json
      }
      fill_candidates: {
        Args: { p_warehouse_id: unknown; p_limit: unknown; arg6: unknown; arg8?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown }
        Returns: Json
      }
      fill_demand: {
        Args: { p_cat_scope: unknown; p_date: unknown; arg6: unknown; arg8: unknown; arg10?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown }
        Returns: Json
      }
      fill_order_rollup: {
        Args: { p_now: unknown; arg4?: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown }
        Returns: string
      }
      fill_orders_page: {
        Args: { p_warehouse_id: unknown; p_to: unknown; p_assignee: unknown; p_offset: unknown; arg10: unknown; arg12: unknown; arg14: unknown; arg16: unknown; arg18: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown }
        Returns: Json
      }
      fill_report: {
        Args: { p_warehouse_id: unknown; p_to: unknown; arg6: unknown; arg8: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown }
        Returns: Json
      }
      fill_scan_apply: {
        Args: { p_entry_id: unknown; p_actor_id: unknown; p_take_over: unknown; p_now: unknown; arg10: unknown; arg12: unknown; arg14: unknown; arg16: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown }
        Returns: Json
      }
      fill_task_topup: {
        Args: { p_target_date: unknown; p_required_date: unknown; p_add_pallets: unknown; arg8: unknown; arg10: unknown; arg12: unknown; arg14: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown }
        Returns: Json
      }
      forklift_report: {
        Args: { p_to: unknown; arg4: unknown; arg6?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown }
        Returns: Json
      }
      gate_leaves_page: {
        Args: { p_limit: unknown; p_date_to: unknown; p_warehouse_type: unknown; p_company_id: unknown; p_status?: unknown; p_categories?: unknown; p_wt_order?: unknown; p_collapsed_wh?: unknown; p_collapsed_vt?: unknown; p_vt_null?: unknown; arg22?: unknown; arg24?: unknown; arg26?: unknown; arg28?: unknown; arg30?: unknown; arg32?: unknown; arg34?: unknown; arg36?: unknown; arg38?: unknown; arg40?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown; arg62?: unknown; arg63?: unknown; arg64?: unknown; arg65?: unknown; arg66?: unknown; arg67?: unknown; arg68?: unknown; arg69?: unknown; arg70?: unknown; arg71?: unknown; arg72?: unknown; arg73?: unknown; arg74?: unknown; arg75?: unknown; arg76?: unknown; arg77?: unknown; arg78?: unknown; arg79?: unknown; arg80?: unknown; arg81?: unknown; arg82?: unknown; arg83?: unknown; arg84?: unknown; arg85?: unknown; arg86?: unknown; arg87?: unknown; arg88?: unknown; arg89?: unknown; arg90?: unknown; arg91?: unknown; arg92?: unknown; arg93?: unknown; arg94?: unknown; arg95?: unknown; arg96?: unknown; arg97?: unknown; arg98?: unknown; arg99?: unknown; arg100?: unknown; arg101?: unknown; arg102?: unknown; arg103?: unknown; arg104?: unknown; arg105?: unknown; arg106?: unknown; arg107?: unknown; arg108?: unknown; arg109?: unknown; arg110?: unknown }
        Returns: Json
      }
      gate_tree: {
        Args: { p_date_to: unknown; p_warehouse_type: unknown; p_company_id?: unknown; p_status?: unknown; p_categories?: unknown; arg12?: unknown; arg14?: unknown; arg16?: unknown; arg18?: unknown; arg20?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown }
        Returns: Json
      }
      gdo_assign_dock: {
        Args: { p_dock_id: unknown; p_actor: unknown; arg6: unknown; arg8: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown }
        Returns: Json
      }
      gdo_holds_dock: {
        Args: { p_dock_assigned_at: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown }
        Returns: boolean
      }
      gdo_status_label: {
        Args: { p_assigned_at: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown }
        Returns: string
      }
      gdo_weight_estimates: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown; arg7?: unknown }
        Returns: Json
      }
      get_outbound_scan_log: {
        Args: { p_to_date?: unknown; p_material_category?: unknown; p_distributor?: unknown; p_pallet_code?: unknown; p_machine_codes?: unknown; p_scanner_name?: unknown; p_limit?: unknown; p_allowed_categories?: unknown; id?: unknown; cartons_scanned?: unknown; best_available_date?: unknown; is_loose_picking?: unknown; loose_confirmed_by_name?: unknown; delivery_date?: unknown; container_number?: unknown; loader_name?: unknown; started_at?: unknown }
        Returns: Record<string, unknown>[]
      }
      get_scan_log_facets: {
        Args: { p_warehouse_ids?: unknown; machines?: unknown; arg6?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown }
        Returns: Record<string, unknown>[]
      }
      gin_extract_query_trgm: {
        Args: { arg2: unknown; arg4: unknown; arg6: unknown; arg8: unknown; arg10: unknown; arg12: unknown; arg14: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown }
        Returns: unknown
      }
      gin_extract_value_trgm: {
        Args: { arg2: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown }
        Returns: unknown
      }
      gin_trgm_consistent: {
        Args: { arg2: unknown; arg4: unknown; arg6: unknown; arg8: unknown; arg10: unknown; arg12: unknown; arg14: unknown; arg16: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown }
        Returns: boolean
      }
      gin_trgm_triconsistent: {
        Args: { arg2: unknown; arg4: unknown; arg6: unknown; arg8: unknown; arg10: unknown; arg12: unknown; arg14: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown }
        Returns: string
      }
      gtrgm_compress: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown }
        Returns: unknown
      }
      gtrgm_consistent: {
        Args: { arg2: unknown; arg4: unknown; arg6: unknown; arg8: unknown; arg10: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown }
        Returns: boolean
      }
      gtrgm_decompress: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown }
        Returns: unknown
      }
      gtrgm_distance: {
        Args: { arg2: unknown; arg4: unknown; arg6: unknown; arg8: unknown; arg10: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown }
        Returns: number
      }
      gtrgm_in: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown }
        Returns: unknown
      }
      gtrgm_options: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown }
        Returns: undefined
      }
      gtrgm_out: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown; arg7?: unknown }
        Returns: unknown
      }
      gtrgm_penalty: {
        Args: { arg2: unknown; arg4: unknown; arg6: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown }
        Returns: unknown
      }
      gtrgm_picksplit: {
        Args: { arg2: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown }
        Returns: unknown
      }
      gtrgm_same: {
        Args: { arg2: unknown; arg4: unknown; arg6: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown }
        Returns: unknown
      }
      gtrgm_union: {
        Args: { arg2: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown }
        Returns: unknown
      }
      hr_attendance_matrix: {
        Args: { p_wh: unknown; p_jt_name: unknown; p_from: unknown; p_work_dates: unknown; p_offset: unknown; arg12: unknown; arg14: unknown; arg16: unknown; arg18: unknown; arg20: unknown; arg22: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown }
        Returns: Json
      }
      hr_employees_page: {
        Args: { p_dept: unknown; p_wh: unknown; p_active: unknown; p_offset: unknown; arg10: unknown; arg12: unknown; arg14: unknown; arg16: unknown; arg18: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown } | { p_dept: unknown; p_wh: unknown; p_active: unknown; p_status: unknown; p_limit: unknown; arg12: unknown; arg14: unknown; arg16: unknown; arg18: unknown; arg20: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown }
        Returns: Json
      }
      hr_leaves_page: {
        Args: { p_warehouse: unknown; p_employee: unknown; p_status: unknown; p_to: unknown; p_limit: unknown; arg12: unknown; arg14: unknown; arg16: unknown; arg18: unknown; arg20: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown }
        Returns: Json
      }
      immutable_unaccent: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown }
        Returns: string
      }
      inbound_orders_facets: {
        Args: { p_scope_categories?: unknown; p_status?: unknown; p_date_to?: unknown; arg8?: unknown; arg10?: unknown; arg12?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown }
        Returns: Json
      }
      inbound_orders_page: {
        Args: { p_limit: unknown; p_scope_categories: unknown; p_status?: unknown; p_date_to?: unknown; p_cycles?: unknown; p_shift_ids?: unknown; p_importer_ids?: unknown; p_search_mat_ids?: unknown; arg18?: unknown; arg20?: unknown; arg22?: unknown; arg24?: unknown; arg26?: unknown; arg28?: unknown; arg30?: unknown; arg32?: unknown; arg34?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown; arg62?: unknown; arg63?: unknown; arg64?: unknown; arg65?: unknown; arg66?: unknown; arg67?: unknown; arg68?: unknown; arg69?: unknown; arg70?: unknown; arg71?: unknown; arg72?: unknown; arg73?: unknown; arg74?: unknown; arg75?: unknown; arg76?: unknown; arg77?: unknown; arg78?: unknown; arg79?: unknown; arg80?: unknown; arg81?: unknown; arg82?: unknown; arg83?: unknown; arg84?: unknown; arg85?: unknown; arg86?: unknown; arg87?: unknown; arg88?: unknown; arg89?: unknown; arg90?: unknown; arg91?: unknown; arg92?: unknown; arg93?: unknown; arg94?: unknown; arg95?: unknown; arg96?: unknown }
        Returns: Json
      }
      inbound_orders_summary: {
        Args: { p_scope_categories?: unknown; p_status?: unknown; p_date_to?: unknown; p_cycles?: unknown; p_shift_ids?: unknown; p_importer_ids?: unknown; p_search_mat_ids?: unknown; arg16?: unknown; arg18?: unknown; arg20?: unknown; arg22?: unknown; arg24?: unknown; arg26?: unknown; arg28?: unknown; arg30?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown; arg62?: unknown; arg63?: unknown; arg64?: unknown; arg65?: unknown; arg66?: unknown; arg67?: unknown; arg68?: unknown; arg69?: unknown; arg70?: unknown; arg71?: unknown; arg72?: unknown; arg73?: unknown; arg74?: unknown; arg75?: unknown; arg76?: unknown; arg77?: unknown; arg78?: unknown; arg79?: unknown; arg80?: unknown; arg81?: unknown; arg82?: unknown; arg83?: unknown; arg84?: unknown; arg85?: unknown; arg86?: unknown }
        Returns: Json
      }
      inventory_band_totals: {
        Args: { p_status: unknown; p_location_ids: unknown; p_categories: unknown; p_search: unknown; p_search_loc_ids: unknown; p_cycles: unknown; p_nmsx: unknown; p_import_from: unknown; arg18: unknown; arg20: unknown; arg22: unknown; arg24: unknown; arg26: unknown; arg28: unknown; arg30: unknown; arg32: unknown; arg34: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown; arg62?: unknown; arg63?: unknown; arg64?: unknown; arg65?: unknown; arg66?: unknown; arg67?: unknown; arg68?: unknown; arg69?: unknown; arg70?: unknown; arg71?: unknown; arg72?: unknown; arg73?: unknown; arg74?: unknown; arg75?: unknown; arg76?: unknown; arg77?: unknown; arg78?: unknown; arg79?: unknown; arg80?: unknown; arg81?: unknown; arg82?: unknown; arg83?: unknown; arg84?: unknown; arg85?: unknown; arg86?: unknown; arg87?: unknown; arg88?: unknown; arg89?: unknown; arg90?: unknown; arg91?: unknown; arg92?: unknown; arg93?: unknown; arg94?: unknown; arg95?: unknown; arg96?: unknown; arg97?: unknown; arg98?: unknown; arg99?: unknown; arg100?: unknown; arg101?: unknown; arg102?: unknown; arg103?: unknown; arg104?: unknown; arg105?: unknown; arg106?: unknown; arg107?: unknown; arg108?: unknown; arg109?: unknown; arg110?: unknown; arg111?: unknown; arg112?: unknown }
        Returns: Json
      }
      inventory_facet_values: {
        Args: { p_categories?: unknown; val?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown }
        Returns: Record<string, unknown>[]
      }
      inventory_summary_page: {
        Args: { p_status: unknown; p_location_ids: unknown; p_categories: unknown; p_search: unknown; p_search_loc_ids: unknown; p_cycles: unknown; p_nmsx: unknown; p_import_from: unknown; p_offset: unknown; arg20: unknown; arg22: unknown; arg24: unknown; arg26: unknown; arg28: unknown; arg30: unknown; arg32: unknown; arg34: unknown; arg36: unknown; arg38: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown; arg62?: unknown; arg63?: unknown; arg64?: unknown; arg65?: unknown; arg66?: unknown; arg67?: unknown; arg68?: unknown; arg69?: unknown; arg70?: unknown; arg71?: unknown; arg72?: unknown; arg73?: unknown; arg74?: unknown; arg75?: unknown; arg76?: unknown; arg77?: unknown; arg78?: unknown; arg79?: unknown; arg80?: unknown; arg81?: unknown; arg82?: unknown; arg83?: unknown; arg84?: unknown; arg85?: unknown; arg86?: unknown; arg87?: unknown; arg88?: unknown; arg89?: unknown; arg90?: unknown; arg91?: unknown; arg92?: unknown; arg93?: unknown; arg94?: unknown; arg95?: unknown; arg96?: unknown; arg97?: unknown; arg98?: unknown; arg99?: unknown; arg100?: unknown; arg101?: unknown; arg102?: unknown; arg103?: unknown; arg104?: unknown; arg105?: unknown; arg106?: unknown; arg107?: unknown; arg108?: unknown; arg109?: unknown; arg110?: unknown; arg111?: unknown; arg112?: unknown; arg113?: unknown; arg114?: unknown; arg115?: unknown; arg116?: unknown; arg117?: unknown; arg118?: unknown; arg119?: unknown; arg120?: unknown; arg121?: unknown; arg122?: unknown }
        Returns: Json
      }
      like_esc: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown }
        Returns: string
      }
      locations_page: {
        Args: { p_limit: unknown; p_category: unknown; p_tokens?: unknown; p_incl_inactive?: unknown; p_pick_face?: unknown; p_slot_no_in?: unknown; arg14?: unknown; arg16?: unknown; arg18?: unknown; arg20?: unknown; arg22?: unknown; arg24?: unknown; arg26?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown; arg62?: unknown; arg63?: unknown; arg64?: unknown; arg65?: unknown; arg66?: unknown; arg67?: unknown; arg68?: unknown; arg69?: unknown; arg70?: unknown }
        Returns: Json
      }
      locations_summary: {
        Args: { p_category?: unknown; p_tokens?: unknown; p_pick_face?: unknown; p_slot_no_in?: unknown; arg10?: unknown; arg12?: unknown; arg14?: unknown; arg16?: unknown; arg18?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown }
        Returns: Json
      }
      loose_picking_facets: {
        Args: { p_cat_scope: unknown; p_from: unknown; arg6: unknown; arg8: unknown; arg10: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown }
        Returns: Json
      }
      loose_picking_page: {
        Args: { p_cat_scope: unknown; p_from: unknown; p_wh_types: unknown; p_dvvts: unknown; p_search: unknown; p_limit: unknown; arg14: unknown; arg16: unknown; arg18: unknown; arg20: unknown; arg22: unknown; arg24: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown; arg62?: unknown; arg63?: unknown; arg64?: unknown; arg65?: unknown; arg66?: unknown; arg67?: unknown }
        Returns: Json
      }
      lot_trace: {
        Args: { p_value: unknown; p_prod_to?: unknown; p_ship_to?: unknown; p_categories?: unknown; p_codes?: unknown; p_machine?: unknown; p_pallet?: unknown; p_batch?: unknown; p_trip?: unknown; arg20?: unknown; arg22?: unknown; arg24?: unknown; arg26?: unknown; arg28?: unknown; arg30?: unknown; arg32?: unknown; arg34?: unknown; arg36?: unknown; arg38?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown; arg62?: unknown; arg63?: unknown; arg64?: unknown; arg65?: unknown; arg66?: unknown; arg67?: unknown; arg68?: unknown; arg69?: unknown; arg70?: unknown; arg71?: unknown; arg72?: unknown; arg73?: unknown; arg74?: unknown; arg75?: unknown; arg76?: unknown; arg77?: unknown; arg78?: unknown; arg79?: unknown; arg80?: unknown; arg81?: unknown; arg82?: unknown; arg83?: unknown; arg84?: unknown; arg85?: unknown; arg86?: unknown; arg87?: unknown; arg88?: unknown; arg89?: unknown; arg90?: unknown; arg91?: unknown; arg92?: unknown; arg93?: unknown; arg94?: unknown; arg95?: unknown; arg96?: unknown; arg97?: unknown; arg98?: unknown; arg99?: unknown }
        Returns: Json
      }
      material_abc: {
        Args: { p_categories: unknown; material_id?: unknown; short_name?: unknown }
        Returns: Record<string, unknown>[]
      }
      material_categories: {
        Args: Record<PropertyKey, never>
        Returns: Record<string, unknown>[]
      }
      materials_page: {
        Args: { p_limit: unknown; p_categories: unknown; p_status?: unknown; p_dq?: unknown; p_legacy_no_sl?: unknown; p_dims?: unknown; arg14?: unknown; arg16?: unknown; arg18?: unknown; arg20?: unknown; arg22?: unknown; arg24?: unknown; arg26?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown; arg62?: unknown; arg63?: unknown; arg64?: unknown; arg65?: unknown; arg66?: unknown; arg67?: unknown; arg68?: unknown; arg69?: unknown; arg70?: unknown; arg71?: unknown; arg72?: unknown; arg73?: unknown; arg74?: unknown; arg75?: unknown; arg76?: unknown; arg77?: unknown }
        Returns: Json
      }
      materials_summary: {
        Args: { p_categories?: unknown; p_status?: unknown; p_dq?: unknown; p_legacy_no_sl?: unknown; p_dims?: unknown; arg12?: unknown; arg14?: unknown; arg16?: unknown; arg18?: unknown; arg20?: unknown; arg22?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown; arg62?: unknown; arg63?: unknown; arg64?: unknown; arg65?: unknown; arg66?: unknown; arg67?: unknown }
        Returns: Json
      }
      move_pallets_to_location: {
        Args: { p_location_id: unknown; p_update_date: unknown; p_max_materials: unknown; p_putaway_violation: unknown; arg10: unknown; arg12?: unknown; arg14?: unknown; arg16?: unknown; arg18?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown }
        Returns: string
      }
      omni_location_ids: {
        Args: { id: unknown; arg6?: unknown }
        Returns: Record<string, unknown>[]
      }
      omni_material_ids: {
        Args: { id: unknown; arg6?: unknown }
        Returns: Record<string, unknown>[]
      }
      omni_narrow_import_material_ids: {
        Args: { id: unknown; arg6?: unknown; arg7?: unknown }
        Returns: Record<string, unknown>[]
      }
      omni_narrow_location_ids: {
        Args: { id: unknown; arg6?: unknown; arg7?: unknown }
        Returns: Record<string, unknown>[]
      }
      omni_narrow_material_ids: {
        Args: { id: unknown; arg6?: unknown; arg7?: unknown }
        Returns: Record<string, unknown>[]
      }
      outbound_adjust_entry: {
        Args: { p_delta_remaining: unknown; p_now: unknown; arg6: unknown; arg8: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown }
        Returns: Json
      }
      outbound_claim_quota: {
        Args: { p_want: unknown; p_complete_when_full: unknown; arg6: unknown; arg8: unknown; arg10: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown }
        Returns: Json
      }
      outbound_consume_exact: {
        Args: { p_amount: unknown; arg4: unknown; arg6: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown }
        Returns: Json
      }
      outbound_date_rule_lines: {
        Args: { p_to: unknown; p_warehouse_id: unknown; p_state?: unknown; p_limit?: unknown; p_source?: unknown; p_kinds?: unknown; arg14?: unknown; arg16?: unknown; arg18?: unknown; arg20?: unknown; arg22?: unknown; arg24?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown; arg62?: unknown; arg63?: unknown; arg64?: unknown; arg65?: unknown; arg66?: unknown }
        Returns: Json
      }
      outbound_gdos_facets: {
        Args: { p_scope_categories?: unknown; p_date_to?: unknown; arg6?: unknown; arg8?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown }
        Returns: Json
      }
      outbound_gdos_page: {
        Args: { p_limit: unknown; p_scope_categories: unknown; p_status?: unknown; p_date_from?: unknown; p_export_types?: unknown; p_npps?: unknown; p_status_labels?: unknown; p_search_gdo_ids?: unknown; arg18?: unknown; arg20?: unknown; arg22?: unknown; arg24?: unknown; arg26?: unknown; arg28?: unknown; arg30?: unknown; arg32?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown; arg62?: unknown; arg63?: unknown; arg64?: unknown; arg65?: unknown; arg66?: unknown; arg67?: unknown; arg68?: unknown; arg69?: unknown; arg70?: unknown; arg71?: unknown; arg72?: unknown; arg73?: unknown; arg74?: unknown; arg75?: unknown; arg76?: unknown; arg77?: unknown; arg78?: unknown; arg79?: unknown; arg80?: unknown; arg81?: unknown; arg82?: unknown; arg83?: unknown; arg84?: unknown; arg85?: unknown; arg86?: unknown; arg87?: unknown; arg88?: unknown; arg89?: unknown; arg90?: unknown }
        Returns: Json
      }
      outbound_gdos_summary: {
        Args: { p_scope_categories?: unknown; p_status?: unknown; p_date_from?: unknown; p_export_types?: unknown; p_npps?: unknown; p_status_labels?: unknown; p_search_gdo_ids?: unknown; arg16?: unknown; arg18?: unknown; arg20?: unknown; arg22?: unknown; arg24?: unknown; arg26?: unknown; arg28?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown; arg62?: unknown; arg63?: unknown; arg64?: unknown; arg65?: unknown; arg66?: unknown; arg67?: unknown; arg68?: unknown; arg69?: unknown; arg70?: unknown; arg71?: unknown; arg72?: unknown; arg73?: unknown; arg74?: unknown; arg75?: unknown; arg76?: unknown; arg77?: unknown; arg78?: unknown; arg79?: unknown; arg80?: unknown }
        Returns: Json
      }
      outbound_pool_apply: {
        Args: { p_material_code: unknown; p_mode: unknown; p_item_status: unknown; p_claim_only_pending: unknown; arg10: unknown; arg12: unknown; arg14?: unknown; arg16?: unknown; arg18?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown }
        Returns: Json
      }
      outbound_shortage_stats: {
        Args: { p_date: unknown; demand: unknown }
        Returns: Record<string, unknown>[]
      }
      packing_logs_recon: {
        Args: { p_wh?: unknown; p_from?: unknown; p_machine?: unknown; p_search?: unknown; p_page?: unknown; arg12?: unknown; arg14?: unknown; arg16?: unknown; arg18?: unknown; arg20?: unknown; arg22?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown; arg62?: unknown; arg63?: unknown; arg64?: unknown; arg65?: unknown; arg66?: unknown; arg67?: unknown; arg68?: unknown; arg69?: unknown; arg70?: unknown; arg71?: unknown }
        Returns: Json
      }
      packing_open_run: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown; arg7?: unknown }
        Returns: Json
      }
      packing_runs_received: {
        Args: { run_id: unknown }
        Returns: Record<string, unknown>[]
      }
      pallet_op_material_code: {
        Args: { p_source: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown }
        Returns: string
      }
      pallet_ops_page: {
        Args: { p_type: unknown; p_search: unknown; p_to: unknown; p_limit: unknown; arg10: unknown; arg12: unknown; arg14: unknown; arg16: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown }
        Returns: Json
      }
      pallet_prints_facets: {
        Args: { p_cat_scope: unknown; p_to: unknown; arg6: unknown; arg8: unknown; arg10: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown }
        Returns: Json
      }
      pallet_prints_page: {
        Args: { p_cat_scope: unknown; p_to: unknown; p_modes: unknown; p_cycles: unknown; p_printers: unknown; p_limit: unknown; arg14: unknown; arg16: unknown; arg18: unknown; arg20: unknown; arg22: unknown; arg24: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown; arg62?: unknown; arg63?: unknown; arg64?: unknown; arg65?: unknown; arg66?: unknown; arg67?: unknown; arg68?: unknown; arg69?: unknown; arg70?: unknown; arg71?: unknown; arg72?: unknown; arg73?: unknown; arg74?: unknown; arg75?: unknown; arg76?: unknown; arg77?: unknown; arg78?: unknown; arg79?: unknown; arg80?: unknown; arg81?: unknown; arg82?: unknown }
        Returns: Json
      }
      putaway_slot_facts: {
        Args: { p_material_id: unknown; p_with_mats?: unknown; pallets?: unknown; same_material?: unknown }
        Returns: Record<string, unknown>[]
      }
      qty_entry_decimal: {
        Args: { p_entry_unit: unknown; arg4: unknown; arg6: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown }
        Returns: number
      }
      realtime_readiness: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      recount_slot: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown }
        Returns: undefined
      }
      rename_warehouse_type: {
        Args: { p_new: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown }
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
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown }
        Returns: string
      }
      scan_insert_pallet: {
        Args: { p_location_id: unknown; p_max_materials: unknown; arg6: unknown; arg8?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown }
        Returns: string
      }
      search_outbound_scan_log: {
        Args: { p_warehouse_ids: unknown; p_limit?: unknown; id?: unknown; cartons_scanned?: unknown; best_available_date?: unknown }
        Returns: Record<string, unknown>[]
      }
      secdef_public_grants: {
        Args: Record<PropertyKey, never>
        Returns: Record<string, unknown>[]
      }
      service_level: {
        Args: { p_to: unknown; p_limit: unknown; arg6?: unknown; arg8?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown }
        Returns: Json
      }
      set_limit: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown }
        Returns: number
      }
      show_limit: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      show_trgm: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown }
        Returns: unknown
      }
      similarity: {
        Args: { arg2: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown }
        Returns: number
      }
      similarity_dist: {
        Args: { arg2: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown }
        Returns: number
      }
      similarity_op: {
        Args: { arg2: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown }
        Returns: boolean
      }
      slotting_stats: {
        Args: { p_categories: unknown; arg4?: unknown; arg6?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown }
        Returns: Json
      }
      slotting_stats_cached: {
        Args: { p_categories: unknown; p_ttl_seconds: unknown; arg6: unknown; arg8?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown }
        Returns: Json
      }
      stocktake_entries_page: {
        Args: { p_from: unknown; p_view: unknown; p_limit: unknown; arg8: unknown; arg10: unknown; arg12: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown }
        Returns: Json
      }
      stocktake_log_page: {
        Args: { p_loc_ids: unknown; p_scope_cats: unknown; p_from: unknown; p_offset: unknown; arg10: unknown; arg12: unknown; arg14: unknown; arg16: unknown; arg18: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown; arg62?: unknown; arg63?: unknown }
        Returns: Json
      }
      strict_word_similarity: {
        Args: { arg2: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown }
        Returns: number
      }
      strict_word_similarity_commutator_op: {
        Args: { arg2: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown }
        Returns: boolean
      }
      strict_word_similarity_dist_commutator_op: {
        Args: { arg2: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown }
        Returns: number
      }
      strict_word_similarity_dist_op: {
        Args: { arg2: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown }
        Returns: number
      }
      strict_word_similarity_op: {
        Args: { arg2: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown }
        Returns: boolean
      }
      tms_orders_facets: {
        Args: { p_date_to: unknown; p_ncc_user: unknown; p_scope_wh?: unknown; arg8?: unknown; arg10?: unknown; arg12?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown }
        Returns: Json
      }
      tms_orders_page: {
        Args: { p_limit: unknown; p_date_to: unknown; p_ncc_user: unknown; p_scope_wh: unknown; p_dvvt?: unknown; p_vehicle_types?: unknown; p_unbooked?: unknown; p_search?: unknown; arg18?: unknown; arg20?: unknown; arg22?: unknown; arg24?: unknown; arg26?: unknown; arg28?: unknown; arg30?: unknown; arg32?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown; arg62?: unknown; arg63?: unknown; arg64?: unknown; arg65?: unknown; arg66?: unknown; arg67?: unknown; arg68?: unknown; arg69?: unknown; arg70?: unknown; arg71?: unknown; arg72?: unknown; arg73?: unknown; arg74?: unknown; arg75?: unknown; arg76?: unknown; arg77?: unknown; arg78?: unknown; arg79?: unknown; arg80?: unknown; arg81?: unknown; arg82?: unknown; arg83?: unknown; arg84?: unknown; arg85?: unknown; arg86?: unknown; arg87?: unknown; arg88?: unknown }
        Returns: Json
      }
      tms_orders_summary: {
        Args: { p_date_to: unknown; p_ncc_user: unknown; p_scope_wh?: unknown; p_dvvt?: unknown; p_vehicle_types?: unknown; p_unbooked?: unknown; arg14?: unknown; arg16?: unknown; arg18?: unknown; arg20?: unknown; arg22?: unknown; arg24?: unknown; arg26?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown; arg60?: unknown; arg61?: unknown; arg62?: unknown; arg63?: unknown; arg64?: unknown; arg65?: unknown; arg66?: unknown; arg67?: unknown; arg68?: unknown; arg69?: unknown; arg70?: unknown; arg71?: unknown; arg72?: unknown; arg73?: unknown }
        Returns: Json
      }
      tms_vehicles_page: {
        Args: { p_vt_ids: unknown; p_search: unknown; p_limit: unknown; arg8: unknown; arg10: unknown; arg12: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown }
        Returns: Json
      }
      trace_suggest: {
        Args: { p_search: unknown; arg4?: unknown; arg6?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown }
        Returns: Json
      }
      try_book_slot: {
        Args: { p_delta: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown }
        Returns: boolean
      }
      unaccent: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown } | { arg2: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown }
        Returns: string
      }
      unaccent_init: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown }
        Returns: unknown
      }
      unaccent_lexize: {
        Args: { arg2: unknown; arg4: unknown; arg6: unknown; arg8: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown }
        Returns: unknown
      }
      warehouse_cost_vouchers: {
        Args: { p_to: unknown; p_warehouse_id: unknown; p_page?: unknown; arg8?: unknown; arg10?: unknown; arg12?: unknown; arg14?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown }
        Returns: Json
      }
      warehouse_docks_status: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown }
        Returns: Json
      }
      warehouse_id_uuid_mismatch: {
        Args: Record<PropertyKey, never>
        Returns: Record<string, unknown>[]
      }
      warehouse_kpi: {
        Args: { p_categories?: unknown; p_to?: unknown; p_pct_low?: unknown; p_dead_days?: unknown; arg10?: unknown; arg12?: unknown; arg14?: unknown; arg16?: unknown; arg18?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown }
        Returns: Json
      }
      warehouse_kpi_cached: {
        Args: { p_categories?: unknown; p_to?: unknown; p_pct_low?: unknown; p_dead_days?: unknown; p_skip_snapshot?: unknown; arg12?: unknown; arg14?: unknown; arg16?: unknown; arg18?: unknown; arg20?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown }
        Returns: Json
      }
      warehouse_kpi_series: {
        Args: { p_categories?: unknown; p_from?: unknown; p_std_hours?: unknown; p_slow_days?: unknown; p_ttl_seconds?: unknown; arg12?: unknown; arg14?: unknown; arg16?: unknown; arg18?: unknown; arg20?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown; arg55?: unknown; arg56?: unknown; arg57?: unknown; arg58?: unknown; arg59?: unknown }
        Returns: Json
      }
      warehouse_kpi_trend: {
        Args: { p_categories?: unknown; p_end?: unknown; p_pct_low?: unknown; p_dead_days?: unknown; arg10?: unknown; arg12?: unknown; arg14?: unknown; arg16?: unknown; arg18?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown; arg53?: unknown; arg54?: unknown }
        Returns: Json
      }
      warehouse_map_assign_cells: {
        Args: { p_items: unknown; arg4: unknown; arg6: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown }
        Returns: Json
      }
      warehouse_map_occupancy: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown }
        Returns: Json
      }
      warehouse_productivity: {
        Args: { p_categories?: unknown; p_to?: unknown; arg6?: unknown; arg8?: unknown; arg10?: unknown; arg12?: unknown; arg13?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown }
        Returns: Json
      }
      warehouse_productivity_cached: {
        Args: { p_categories?: unknown; p_to?: unknown; p_ttl_seconds?: unknown; arg8?: unknown; arg10?: unknown; arg12?: unknown; arg14?: unknown; arg15?: unknown; arg16?: unknown; arg17?: unknown; arg18?: unknown; arg19?: unknown; arg20?: unknown; arg21?: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown }
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
        Args: { p_null_ok: unknown; p_to: unknown; p_match: unknown; p_plate: unknown; p_limit: unknown; arg12: unknown; arg14: unknown; arg16: unknown; arg18: unknown; arg20: unknown; arg22?: unknown; arg23?: unknown; arg24?: unknown; arg25?: unknown; arg26?: unknown; arg27?: unknown; arg28?: unknown; arg29?: unknown; arg30?: unknown; arg31?: unknown; arg32?: unknown; arg33?: unknown; arg34?: unknown; arg35?: unknown; arg36?: unknown; arg37?: unknown; arg38?: unknown; arg39?: unknown; arg40?: unknown; arg41?: unknown; arg42?: unknown; arg43?: unknown; arg44?: unknown; arg45?: unknown; arg46?: unknown; arg47?: unknown; arg48?: unknown; arg49?: unknown; arg50?: unknown; arg51?: unknown; arg52?: unknown }
        Returns: Json
      }
      word_similarity: {
        Args: { arg2: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown }
        Returns: number
      }
      word_similarity_commutator_op: {
        Args: { arg2: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown }
        Returns: boolean
      }
      word_similarity_dist_commutator_op: {
        Args: { arg2: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown }
        Returns: number
      }
      word_similarity_dist_op: {
        Args: { arg2: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown }
        Returns: number
      }
      word_similarity_op: {
        Args: { arg2: unknown; arg4: unknown; arg6?: unknown; arg7?: unknown; arg8?: unknown; arg9?: unknown; arg10?: unknown; arg11?: unknown }
        Returns: boolean
      }
      wt_cats: {
        Args: { arg2: unknown; arg4?: unknown; arg5?: unknown; arg6?: unknown }
        Returns: unknown
      }
      zone_capacity_rows: {
        Args: { p_categories: unknown; warehouse_id: unknown }
        Returns: Record<string, unknown>[]
      }
      zone_used_pallets: {
        Args: { warehouse_id: unknown }
        Returns: Record<string, unknown>[]
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
