import { Router } from 'express'
import * as warehouse from '../controllers/masterdata/warehouseController'
import * as subWarehouse from '../controllers/masterdata/subWarehouseController'
import * as location from '../controllers/masterdata/locationController'
import * as manufacturer from '../controllers/masterdata/manufacturerController'
import * as material from '../controllers/masterdata/materialController'

const router = Router()

// Warehouse
router.get('/warehouses',          warehouse.listWarehouses)
router.post('/warehouses',         warehouse.createWarehouse)
router.get('/warehouses/:id',      warehouse.getWarehouse)
router.put('/warehouses/:id',      warehouse.updateWarehouse)
router.delete('/warehouses/:id',   warehouse.deleteWarehouse)

// SubWarehouse
router.get('/sub-warehouses',         subWarehouse.listSubWarehouses)
router.post('/sub-warehouses',        subWarehouse.createSubWarehouse)
router.get('/sub-warehouses/:id',     subWarehouse.getSubWarehouse)
router.put('/sub-warehouses/:id',     subWarehouse.updateSubWarehouse)
router.delete('/sub-warehouses/:id',  subWarehouse.deleteSubWarehouse)

// Location
router.get('/locations',         location.listLocations)
router.post('/locations',        location.createLocation)
router.get('/locations/:id',     location.getLocation)
router.put('/locations/:id',     location.updateLocation)
router.delete('/locations/:id',  location.deleteLocation)

// Manufacturer
router.get('/manufacturers',         manufacturer.listManufacturers)
router.post('/manufacturers',        manufacturer.createManufacturer)
router.get('/manufacturers/:id',     manufacturer.getManufacturer)
router.put('/manufacturers/:id',     manufacturer.updateManufacturer)
router.delete('/manufacturers/:id',  manufacturer.deleteManufacturer)

// Material
router.get('/materials',         material.listMaterials)
router.post('/materials',        material.createMaterial)
router.get('/materials/:id',     material.getMaterial)
router.put('/materials/:id',     material.updateMaterial)
router.delete('/materials/:id',  material.deleteMaterial)

export default router
