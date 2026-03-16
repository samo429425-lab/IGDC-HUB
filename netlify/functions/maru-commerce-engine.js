"use strict";

/*
 MARU Commerce Engine
 product → cart → order → checkout → confirm
*/

const revenueEngine = require("./maru-revenue-engine");

/* MEMORY STORAGE (초기 버전) */

const PRODUCTS = new Map();
const CARTS = new Map();
const ORDERS = new Map();

/* SAMPLE PRODUCT */

PRODUCTS.set("p001",{
  id:"p001",
  title:"Sample Product",
  price:100,
  currency:"USD"
});

/* UTIL */

function generateId(prefix){
  return prefix + "-" + Date.now() + "-" + Math.floor(Math.random()*10000);
}

/* PRODUCT */

function getProduct(id){
  return PRODUCTS.get(id);
}

/* CART */

function getCart(user){

  if(!CARTS.has(user)){
    CARTS.set(user,{ user, items:[] });
  }

  return CARTS.get(user);

}

function cartAdd(user,productId,qty){

  const cart = getCart(user);
  const product = getProduct(productId);

  if(!product){
    return { status:"product-not-found" };
  }

  cart.items.push({
    productId,
    qty:qty || 1,
    price:product.price
  });

  return { status:"added", cart };

}

/* ORDER */

function createOrder(user){

  const cart = getCart(user);

  if(!cart.items.length){
    return { status:"cart-empty" };
  }

  let amount = 0;

  for(const item of cart.items){
    amount += item.price * item.qty;
  }

  const orderId = generateId("ord");

  const order = {
    orderId,
    user,
    items:cart.items,
    amount,
    currency:"USD",
    status:"created"
  };

  ORDERS.set(orderId,order);

  cart.items = [];

  return { status:"order-created", order };

}

/* CHECKOUT */

function checkout(orderId){

  const order = ORDERS.get(orderId);

  if(!order){
    return { status:"order-not-found" };
  }

  order.status = "checkout";

  return {
    status:"checkout",
    order
  };

}

/* CONFIRM */

function confirm(orderId){

  const order = ORDERS.get(orderId);

  if(!order){
    return { status:"order-not-found" };
  }

  order.status = "paid";

  /* REVENUE HOOK */

  revenueEngine.hookCommerce({
    amount:order.amount,
    source:"commerce-engine"
  });

  return {
    status:"confirmed",
    order
  };

}

/* API */

exports.handler = async function(event){

  const body = JSON.parse(event.body || "{}");
  const action = body.action;

  if(action === "product"){
    return { statusCode:200, body:JSON.stringify([...PRODUCTS.values()]) };
  }

  if(action === "cart_add"){
    return { statusCode:200, body:JSON.stringify(
      cartAdd(body.user,body.productId,body.qty)
    )};
  }

  if(action === "create_order"){
    return { statusCode:200, body:JSON.stringify(
      createOrder(body.user)
    )};
  }

  if(action === "checkout"){
    return { statusCode:200, body:JSON.stringify(
      checkout(body.orderId)
    )};
  }

  if(action === "confirm"){
    return { statusCode:200, body:JSON.stringify(
      confirm(body.orderId)
    )};
  }

  return {
    statusCode:200,
    body:JSON.stringify({status:"commerce-engine-ready"})
  };

};