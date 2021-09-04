import { interval, fromEvent } from 'rxjs'
import { map, takeUntil, flatMap, filter, scan, merge, count} from 'rxjs/operators'

type Key = 'ArrowLeft' | 'ArrowRight' | 'Space' | 'w'
type Event = 'keydown' | 'keyup'
type Directions = 'left' | 'right'
type ViewType = 'ship' | 'bullet' | 'alien'
const Constants = {
  CanvasSize: 600,
  BulletExpirationTime: 60,
  BulletRadius: 3,
  BulletSpeed: -10,
  StartTime: 0,
  AlienRowSize: 2,
  AlienRowOffset: 1,
  AlienColumnOffset: 1
} as const


type State = Readonly<{
  time: number;
  ship: Body;
  aliens: ReadonlyArray<Body>;
  bullets: ReadonlyArray<Body>;
  exit: ReadonlyArray<Body>;
  objCount:number;
}>

type Body = Readonly<{
  id: string;
  x: number;
  y: number;
  xspeed: number;
  yspeed: number;
  createTime: number;
  viewType: ViewType;
}>


function spaceinvaders() {
  console.log("Game started")
    // Inside this function you will use the classes and functions 
    // from rx.js
    // to add visuals to the svg element in pong.html, animate them, and make them interactive.
    // Study and complete the tasks in observable exampels first to get ideas.
    // Course Notes showing Asteroids in FRP: https://tgdwyer.github.io/asteroids/ 
    // You will be marked on your functional programming style
    // as well as the functionality that you implement.
    // Document your code!  
    const ship = document.getElementById("ship")!;
    function createShip(): Body{
      return {
        id: 'ship',
        x: Constants.CanvasSize/2,
        y: 550,
        xspeed: 0,
        yspeed: 0,
        createTime: 0,
        viewType: 'ship'
      }
    }
    function createBullet(s:State): Body{
      return {
        id: 'bullet ' + s.objCount,
        x: s.ship.x,
        y: s.ship.y -20,
        xspeed: 0,
        yspeed: -10,
        createTime: s.time,
        viewType: 'bullet'
      }
    }
    function createAlien(s:State, xPos: number, yPos: number): Body{
      return{
        id: 'alien ' + s.objCount,
        x: xPos,
        y: yPos,
        xspeed: 0,
        yspeed: -10,
        createTime: s.time,
        viewType: 'alien'
      }
    }


    const initialState: State = {
        time: 0,
        ship: createShip(),
        aliens: [],
        bullets: [],
        exit: [],
        objCount: 0,
    }

    //This is a function that will be used to generate aliens for a level
    //Since in Space invaders each row has different aliens each parameter 
    //corresponds to one row of a type of alien to make eg, first row is shooter alien, 2nd row is strong alien ect
    //The function works top to bottom with the new aliens being generated at the top of the canvas and for each parameter 
    //get sent down a step
    const generateAliens = (s: State,xCounter: number = 0,yCounter = 0, ...f : ((state: State, x: number, y: number) => Body)[]) => {
      if (xCounter == Constants.AlienRowSize ){
        return <State> {...s}
      }
      else if(yCounter == f.length){
        console.log(yCounter)
        return <State> {...s}
      }
      
      else{
        console.log("y is "+yCounter + " x is "+xCounter)
        return generateAliens(
          generateAliens(
          {...s, objCount: s.objCount + 1, aliens: s.aliens.concat(f[yCounter](s,0 + (Constants.AlienRowOffset * xCounter),0 + (Constants.AlienColumnOffset * yCounter)))}, //This row creates the state with the alien added to it
          xCounter + 1, yCounter,...f),  //Inner generation
          0, yCounter + 1, ...f)  //Outer generation
      }
    }
     // xCounter == Constants.AlienRowSize ? return <State> {...s}:
    //  yCounter == f.length ? {...s}:
    
      //Late night robert notes
      //The function can't have two recursive calls on itself because it creates x * x not x * y
      //Only solution is make a function that creates an x
      //Make a function that repeats that but changes the values
      //If there is a way to fix the current version I have no clue what it is besides restructuring.
    const tick = (s:State, elapsed:number)=>{
      const not = <T>(f:(x:T)=>boolean)=>(x:T)=>!f(x),
      expired = (b:Body)=>(elapsed - b.createTime) > 60,
      expiredBullets:Body[] = s.bullets.filter(expired),
      activeBullets = s.bullets.filter(not(expired));
      return <State>{
        ...s,
        ship: moveObject(s.ship),
        bullets: activeBullets.map(moveObject),
        exit: expiredBullets,
        time: elapsed
      }
    }
    class TestObservable { constructor() {} }
    class Tick { constructor(public readonly elapsed:number) {} }
    class Move { constructor(public readonly direction:number) {} }
    class StopMoving { constructor(public readonly stopMoving:Directions) {} }
    class Shoot { constructor() {} }

  //Might remove gameclock
  const 
  gameClock = interval(10)
    .pipe(map(elapsed=>new Tick(elapsed))),

  keyObservable = <T>(e:Event, k:Key, result:()=>T)=>
    fromEvent<KeyboardEvent>(document,e)
      .pipe(
        filter(({code})=>code === k),
        filter(({repeat})=>!repeat),
        map(result)),

    moveLeft = keyObservable('keydown','ArrowLeft',()=>new Move(-3)),
    moveRight = keyObservable('keydown','ArrowRight',()=>new Move(3)),
    stopMoveLeft = keyObservable('keyup','ArrowLeft',()=>new StopMoving('left')),
    stopMoveRight = keyObservable('keyup','ArrowRight',()=>new StopMoving('right')),
    shoot = keyObservable('keydown','Space', ()=>new Shoot()),
    test = keyObservable('keydown','ArrowLeft', ()=>new TestObservable()),

    reduceState = (s:State, e: Move | Tick | StopMoving | Shoot) => 
      e instanceof Move ? {...s,
        ship: {...s.ship, xspeed: e.direction}} : 
        //This ternary checks to see if the player is moving right when the upkey is pressed. If not it returns default state otherwise it sets speed of ship to 0
      e instanceof StopMoving ?  e.stopMoving === 'right' ? 
        s.ship.xspeed > 0 ? {...s, ship: {...s.ship, xspeed: 0}} :  {...s} : 
        /*Below is the same logic as above but if the player is moving to the left*/ 
        s.ship.xspeed < 0 ? {...s,ship: {...s.ship, xspeed: 0}} :  {...s} 
      :
      e instanceof Shoot ? {...s,
        bullets: s.bullets.concat([createBullet(s)]),
        objCount: s.objCount + 1
      } :
      e instanceof TestObservable ? generateAliens(s, 0,0,createAlien,createAlien)
      :tick(s, e.elapsed)
    ;

    interval(10).pipe(
      map(elapsed => new Tick (elapsed)),
      merge(moveLeft, moveRight, stopMoveLeft, stopMoveRight, shoot, test),
      scan(reduceState, initialState)
    ).subscribe(console.log)

    //Movement
    //fromEvent<KeyboardEvent>(document, 'keydown')
  //  .pipe(
   //   filter(({code})=>code === 'ArrowLeft' || code === 'ArrowRight'),
 //     filter(({repeat})=>!repeat),
 //     flatMap(d=>interval(10).pipe(
  //      takeUntil(fromEvent<KeyboardEvent>(document, 'keyup').pipe(
 //         filter(({code})=>code === d.code)
  //      )),
 //       map(_=>d))
  //    ),
 //     map(({code})=>code==='ArrowLeft'?-3:3),
 //     scan(movement, initialState))
 //   .subscribe(updateView)

    
}
    
  
  
  // the following simply runs your pong function on window load.  Make sure to leave it in place.
  if (typeof window != 'undefined')
    window.onload = ()=>{
      spaceinvaders();
    }
  
  


//Controls
const moveObject = (o:Body) => <Body> {
  ...o,
  x: torusWrap(o.x + o.xspeed),
  y: o.y + o.yspeed
}
// Screen Wrapper
const torusWrap = (x: number) : number => { 
  const s=Constants.CanvasSize, 
    wrap = (v:number) => v < 0 ? v + s : v > s ? v - s : v;
  return wrap(x)
}


function updateView(s:State): void {
  console.log("updateviewCalled")
  const svg = document.getElementById("canvas")!
  const ship = document.getElementById("ship")!;
  ship.setAttribute('transform',
   `translate(${s.ship.x},${s.ship.y}) rotate(${0})`)
   ship.classList.add(s.ship.viewType)
   //Adding bullet code
   s.bullets.forEach(b=>{
    const createBulletView = ()=>{
      const v = document.createElementNS(svg.namespaceURI, "ellipse")!;
      v.setAttribute("id",b.id);
      attr(v,{id:b.id,rx:4,ry:4});
      //v.classList.add("bullet")
      v.classList.add(b.viewType)
      svg.appendChild(v)
      return v;
    }
    const v = document.getElementById(b.id) || createBulletView();
    v.setAttribute("cx",String(b.x))
    v.setAttribute("cy",String(b.y))
  })
  s.exit.forEach(o=>{
    const v = document.getElementById(o.id);
    if(v) svg.removeChild(v)
  })
}


/**
 * set a number of attributes on an Element at once
 * @param e the Element
 * @param o a property bag
 */         
 const attr = (e:Element,o:Object) =>
 { for(const k in o) e.setAttribute(k,String(o[k])) }