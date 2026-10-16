-- Incoming supply: open requisitions plus the unreceived quantity of live purchase orders.
CREATE VIEW v_incoming AS
SELECT plant_id, material_id, sum(qty)::int AS qty FROM (
  SELECT plant_id, material_id, quantity AS qty
    FROM purchase_requisitions WHERE status = 'Open'
  UNION ALL
  SELECT po.plant_id, i.material_id, i.quantity - i.received_qty
    FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.purchase_order_id
   WHERE po.status IN ('Pending Approval','Approved','Partially Received')
) x
GROUP BY plant_id, material_id
HAVING sum(qty) > 0;

-- Open demand: sales order quantity not yet goods-issued.
CREATE VIEW v_demand AS
SELECT so.plant_id, i.material_id, sum(i.quantity - COALESCE(gi.qty, 0))::int AS qty
  FROM sales_order_items i
  JOIN sales_orders so ON so.id = i.sales_order_id
  LEFT JOIN (
    SELECT di.sales_order_item_id, sum(di.quantity) AS qty
      FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id
     WHERE d.status IN ('Goods Issued','Billed')
     GROUP BY di.sales_order_item_id
  ) gi ON gi.sales_order_item_id = i.id
 WHERE so.status <> 'Cancelled'
 GROUP BY so.plant_id, i.material_id
HAVING sum(i.quantity - COALESCE(gi.qty, 0)) > 0;
