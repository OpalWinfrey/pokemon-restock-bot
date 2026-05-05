// Add the products you want to track here
//
// IDs by retailer:
//   target.tcin    — in the URL: target.com/p/.../-/A-XXXXXXXX
//   walmart.itemId — in the URL: walmart.com/ip/name/XXXXXXXXXX
//   bestbuy.sku    — in the URL: bestbuy.com/site/name/XXXXXXXXX.p?skuId=XXXXXXXXX
//   costco.itemNumber — 7-digit number in URL: costco.com/product-name.product.XXXXXXX.html

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
      }
    }
  }
  // Add more products here following the same pattern
]
