// Add the products you want to track here.
//
// IDs by retailer:
//   target.tcin       — URL: target.com/p/.../-/A-XXXXXXXX
//   walmart.itemId    — URL: walmart.com/ip/name/XXXXXXXXXX
//   bestbuy.sku       — URL: bestbuy.com/site/name/XXXXXXXXX.p?skuId=XXXXXXXXX
//   costco.itemNumber — 7-digit number in URL: costco.com/name.product.XXXXXXX.html
//   walgreens.sku     — found on the product page URL or barcode lookup
//   cvs.upc           — UPC barcode on the product packaging

export const products = [
  {
    name: "Pokemon Prismatic Evolutions Elite Trainer Box",
    retailers: {
      target: {
        tcin: "89948973",
        url: "https://www.target.com/p/-/A-89948973"
      },
      walmart: {
        itemId: "5678901234",
        url: "https://www.walmart.com/ip/5678901234"
      },
      bestbuy: {
        sku: "1234567",
        url: "https://www.bestbuy.com/site/-/1234567.p"
      },
      costco: {
        itemNumber: "1234567",
        url: "https://www.costco.com/pokemon-prismatic-evolutions-etb.product.1234567.html"
      }
    }
  },
  {
    name: "Pokemon Booster Bundle",
    retailers: {
      target: {
        tcin: "12345678",
        url: "https://www.target.com/p/-/A-12345678"
      },
      walgreens: {
        sku: "987654",
        url: "https://www.walgreens.com/store/c/pokemon/ID=prod987654-product"
      },
      cvs: {
        upc: "0820650850527",
        url: "https://www.cvs.com/shop/pokemon-booster-bundle"
      }
    }
  }
  // Add more products here following the same pattern
]
