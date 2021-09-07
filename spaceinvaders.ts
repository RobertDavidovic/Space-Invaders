import { interval, fromEvent, Observable, Subscriber, Subject, timer, pipe, generate, combineLatest, concat, BehaviorSubject} from 'rxjs'
import { map, takeUntil, filter, scan, merge, count, timeInterval, reduce, subscribeOn} from 'rxjs/operators'

type Key = 'ArrowLeft' | 'ArrowRight' | 'Space' | 'w'
type Event = 'keydown' | 'keyup'
type Directions = 'left' | 'right'
type ViewType = 'ship' | 'bullet' | 'alien' | 'player-bullet' | 'enemy-bullet' | 'shooter'
type GameStatus = 'loss' | 'win' | 'playing'
type AlienCreators = ((state: State, x: number, y: number) => Body)[]

const Constants = {
  CanvasSize: 600,
  AlienStartPoint: 50,
  BulletExpirationTime: 60,
  BulletRadius: 3,
  BulletSpeed: -10,
  StartTime: 0,
  ShipRadius: 20,
} as const


const AlienConstants = {
  RowSize: 10,
  RowOffset: 35,
  ColumnOffset: 35,
  Radius: 10,
  VerticalOffset: 40,
  AlienTurnTime: 90,
  DownJumpOffset: 15
} as const

type State = Readonly<{
  totalTime: number;
  levelTime: number;
  ship: Body;
  aliens: ReadonlyArray<Body>;
  bullets: ReadonlyArray<Body>;
  exit: ReadonlyArray<Body>;
  objCount:number;
  levelFormation: ReadonlyArray<AlienCreators>;
  status: GameStatus;
  score: number;
  level: number;
}>

type Body = Readonly<{
  id: string;
  x: number;
  y: number;
  xspeed: number;
  yspeed: number;
  createTime: number;
  viewType: ViewType;
  collisionRadius: number;
  lives: number;
}>




function spaceinvaders() {
  const lives = document.getElementById("lives")
  const score = document.getElementById("score")
  const level = document.getElementById("levels")
  const playButton = document.getElementById("playButton")
  const svg = document.getElementById("canvas")!
    // Inside this function you will use the classes and functions 
    // from rx.js
    // to add visuals to the svg element in pong.html, animate them, and make them interactive.
    // Study and complete the tasks in observable exampels first to get ideas.
    // Course Notes showing Asteroids in FRP: https://tgdwyer.github.io/asteroids/ 
    // You will be marked on your functional programming style
    // as well as the functionality that you implement.
    // Document your code!  
    function createShip(): Body{
      return {
        id: 'ship',
        x: Constants.CanvasSize/2,
        y: 550,
        xspeed: 0,
        yspeed: 0,
        createTime: 0,
        viewType: 'ship',
        collisionRadius: Constants.ShipRadius,
        lives: 3
      }
    }
    function createBullet(type:string, direction: number, startOffset: number = 0) : ((s: State, owner: Body)=>Body){
      return (s: State, owner: Body)=> <Body>{
        id: type + s.objCount,
        x: owner.x,
        y: owner.y + startOffset,
        xspeed: 0,
        yspeed: direction,
        createTime: s.totalTime,
        viewType: type,
        collisionRadius: Constants.BulletRadius,
      }
    }

    function createAlien(type: string, health: number = 1): ((s:State, xPos: number, yPos: number)=>Body){
      return (s:State, xPos: number, yPos: number)=> <Body>{
      id: type + s.objCount,
      x: xPos,
      y: yPos,
      xspeed: 2,
      yspeed: 0,
      createTime: s.totalTime,
      viewType: type,
      collisionRadius: AlienConstants.Radius,
      lives: health
      }
    }
    
    const defaultAlien = createAlien("alien")
    const shooterAlien = createAlien("shooter")
    const createPlayerBullet = createBullet("player-bullet", -10, -20)
    const createEnemyBullet = createBullet("enemy-bullet", 7)

    const levels= [
      [defaultAlien, defaultAlien, shooterAlien],
      [defaultAlien, shooterAlien, defaultAlien, defaultAlien, defaultAlien],
      [defaultAlien]
    ]
    const initialState: State = {
        totalTime: 0,
        levelTime: 0,
        ship: createShip(),
        aliens: [],
        bullets: [],
        exit: [],
        objCount: 0,
        levelFormation: levels,
        status: 'playing',
        score: 0,
        level: 0,
    }


    //This is a function that will be used to generate aliens for a level
    //Since in Space invaders each row has different aliens each parameter 
    //corresponds to one row of a type of alien to make eg, first row is shooter alien, 2nd row is strong alien ect
    //The function works top to bottom with the new aliens being generated at the top of the canvas and for each parameter 
    //get sent down a step

    const generateAliens = (s: State, ...f :AlienCreators): State=>{
      const generateAlienRow = (s: State,xCounter: number = 0,yCounter = 0, ...alienMaker : AlienCreators) => {
        return xCounter == AlienConstants.RowSize ?
          {...s}:
            generateAlienRow(
            {...s, objCount: s.objCount + 1, aliens: s.aliens.concat(alienMaker[0](s,Constants.AlienStartPoint + (AlienConstants.RowOffset * xCounter),AlienConstants.VerticalOffset + (AlienConstants.ColumnOffset * yCounter - 1)))}, //This row creates the state with the alien added to it
            xCounter + 1, yCounter,...f)} //Inner generation

      return f.length == 0 ? {...s}: generateAliens(generateAlienRow(s, 0, f.length, ...f),...f.slice(1))
    }
    
        // check a State for collisions:
    //   bullets destroy rocks spawning smaller ones
    //   ship colliding with rock ends game
    const handleCollisions = (s:State) => {
      const
        playerBullets = s.bullets.filter((a: Body) => a.viewType == 'player-bullet'),
        bodiesCollided = ([a,b]:[Body,Body]) => collisionDetector(a,b) < a.collisionRadius + b.collisionRadius,

        enemyBullets = s.bullets.filter((b:Body)=>b.viewType == "enemy-bullet"),
        collidedEnemyBullets = enemyBullets.filter(r=>bodiesCollided([s.ship,r])),
        shipCollidedBullets = collidedEnemyBullets.length > 0,
        shipCollidedAliens = s.aliens.filter(r=>bodiesCollided([s.ship,r])).length > 0,
        

        allPlayerBulletsAndAliens = flatMap(playerBullets, b=> s.aliens.map<[Body,Body]>(r=>([b,r]))),
        collidedBulletsAndAliens = allPlayerBulletsAndAliens.filter(bodiesCollided),
        collidedPlayerBullets = collidedBulletsAndAliens.map(([bullet,_])=>bullet),
        collidedAliens = collidedBulletsAndAliens.map(([_,alien])=>alien),

        collidedShooters = collidedAliens.filter((b:Body)=> b.viewType == "shooter"),
        collidedBasicAliens = collidedAliens.filter((b:Body)=> b.viewType == "alien"),

        allCollidedBullets = collidedEnemyBullets.concat(collidedPlayerBullets),

        cut = except((a:Body)=>(b:Body)=>a.id === b.id)
     // 
      return <State>{
        ...s,
        ship: shipCollidedBullets ? <Body>{...s.ship, lives: s.ship.lives - 1}: s.ship,
        aliens: cut(s.aliens)(collidedAliens),
        bullets: cut(s.bullets)(allCollidedBullets),
        exit: s.exit.concat(allCollidedBullets,collidedAliens),
        objCount: s.objCount + collidedAliens.length,
        status: shipCollidedAliens? 'loss' : s.status,
        score: s.score + (collidedShooters.length * 3333) + (collidedBasicAliens.length * 1247)
      }
    }


    const checkAlienPosition = (f: (c : number)=> boolean, coordinate: PropertyKey):((s:State)=>boolean) =>{
      const filterCheck = (b:Body)=> f(b[coordinate]);
        return (s:State)=> s.aliens.filter(filterCheck).length > 0
    
  }

  const checkAlienDirection = (s:State) => {
    return checkAlienLeftBound(s) || checkAlienRightBound(s) ? <State>{...s, aliens: s.aliens.map(flipAlienDirection)} : <State>{...s} 
  }

  const checkAlienLeftBound = checkAlienPosition((x) => x < Constants.AlienStartPoint, 'x')
  const checkAlienRightBound = checkAlienPosition((x) => x > Constants.CanvasSize - Constants.AlienStartPoint, 'x')
  const checkAlienBottomBound = checkAlienPosition((y) => y > Constants.CanvasSize - 20, 'y')

    const checkAlienWin = (s:State) => {
      if(checkAlienBottomBound(s) || s.ship.lives <= 0){
        return <State>{...s, status: 'loss'}
      }
      return <State>{...s}
    } //

  
  const blankState = (s:State)=>{return {
    ...s,
    ship: <Body>{...s.ship, y: -700},
    aliens: [],
    bullets: [],
    exit: s.exit.concat(s.aliens, s.bullets),
    objCount: 0,
    levelFormation: [createAlien],
    score: s.score,
    level: s.level
  }}
  const handleGameOver = (s:State)=> s.status == 'loss' ? blankState({
    ...s, status: 'loss'}):{...s}

    const tick = (s:State, elapsed:number)=>{
      //Level Maker
      if (s.aliens.length == 0 && s.status == 'playing'){
        if(s.levelFormation.length == 0){
          return blankState({...s, status: 'win'})
        }
        return <State>{
          ...generateAliens(s, ...s.levelFormation[0]),
          levelFormation: s.levelFormation.slice(1),
          bullets: [],
          exit: s.bullets,
          level: s.level + 1,
          score: s.score + (s.level * 2000)
        }
      }
      const not = <T>(f:(x:T)=>boolean)=>(x:T)=>!f(x),
      expired = (b:Body)=>(elapsed - b.createTime) > 60,
      expiredBullets:Body[] = s.bullets.filter(expired),
      activeBullets = s.bullets.filter(not(expired));

      return pipe(handleGameOver,handleCollisions, checkAlienDirection, checkAlienWin)({
        ...s,
        ship: moveObject(s.ship),
        bullets: activeBullets.map(moveObject),
        aliens: s.aliens.map(moveObject), 
        exit: expiredBullets,
        totalTime: elapsed,
      })
    }
    class Tick { constructor(public readonly elapsed:number) {} }
    class AlienShot { constructor(public readonly chance:number) {} }
    class Move { constructor(public readonly direction:number) {} }
    class StopMoving { constructor(public readonly stopMoving:Directions) {} }
    class Shoot { constructor() {} }
    class Play { constructor() {} }
     
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

    moveLeft = keyObservable('keydown','ArrowLeft',()=>new Move(-4)),
    moveRight = keyObservable('keydown','ArrowRight',()=>new Move(4)),
    stopMoveLeft = keyObservable('keyup','ArrowLeft',()=>new StopMoving('left')),
    stopMoveRight = keyObservable('keyup','ArrowRight',()=>new StopMoving('right')),
    shoot = keyObservable('keydown','Space', ()=>new Shoot())

    const startGame = fromEvent<Event>(playButton, 'click').pipe(map(()=>new Play()))
    //The victim of war
    //spawner = new BehaviorSubject<Spawn>(new Spawn([createAlien, createAlien, createAlien]))
    
    const alienShot = (s: State, chance: number) =>
      chance > s.aliens.filter((a: Body) => a.viewType == 'shooter').length - 1 ? {...s} : {...s, objCount: s.objCount + 1,bullets: s.bullets.concat(createEnemyBullet(s,s.aliens[chance%s.aliens.length]))}
    

    const reduceState = (s:State, e: Move | Tick | StopMoving | Shoot | AlienShot | Play) => 
      e instanceof Move ? {...s,
        ship: {...s.ship, xspeed: e.direction}} : 
        //This ternary checks to see if the player is moving right when the upkey is pressed. If not it returns default state otherwise it sets speed of ship to 0
      e instanceof StopMoving ?  e.stopMoving === 'right' ? 
        s.ship.xspeed > 0 ? {...s, ship: {...s.ship, xspeed: 0}} :  {...s} : 
        /*Below is the same logic as above but if the player is moving to the left*/ 
        s.ship.xspeed < 0 ? {...s,ship: {...s.ship, xspeed: 0}} :  {...s} 
      :
      e instanceof Shoot ? {...s,
        bullets: s.bullets.concat([createPlayerBullet(s, s.ship)]),
        objCount: s.objCount + 1
      }:
      e instanceof AlienShot ? <State>alienShot(s, e.chance):
      e instanceof Play ? <State> {...initialState, exit: s.exit.concat(s.aliens, s.bullets),}
      :tick(s, e.elapsed)
    ;
  // an instance of the Random Number Generator with a specific seed
  const rng = new RNG(20)
  // return a random number in the range [-1,1]
  const nextRandom = ()=>rng.nextInt() % 150

    // A stream of random numbers
    const randNum$ = interval(75).pipe(map(nextRandom), map((chance) => new AlienShot (chance))) // .pipe(map(nextRandom), map((chance) => new AlienShot (chance))));
    const subscription = interval(10).pipe(
      map(elapsed => new Tick (elapsed)),
      merge(moveLeft, moveRight, stopMoveLeft, stopMoveRight, shoot),
      merge(randNum$),
      merge(startGame),
      scan(reduceState, initialState)
    ).subscribe(updateView)


    //Not a pure function but is only called in update view
    function createText(text: string, colour: string): Element{
      const v = document.createElementNS(svg.namespaceURI, "text")!;
      attr(v,{x:Constants.CanvasSize/3,y:Constants.CanvasSize/2,class:"message", id: "message", fill: colour});
      v.textContent = text;
      svg.appendChild(v);
      return v
    }
    function updateView(s:State): void {
      lives.textContent = `Lives: ${s.ship.lives}`;
      score.textContent = `Score: ${s.score}`;
      level.textContent = `Level: ${s.level}`;
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
      
      const statusText = document.getElementById("message")
      if (!statusText){
        if(s.status == 'loss') {
          createText("Game Over", "red")
         }
         if (s.status == 'win'){
           createText("You've Won!", "white")
         }
      }
      else if (s.status == "playing"){
        console.log(statusText)
        svg.removeChild(statusText) 
      }
      //Adding Alien code --Make better later
      s.aliens.forEach(b=>{
        const createAlienView = ()=>{
          const v = document.createElementNS(svg.namespaceURI, "ellipse")!;
          v.setAttribute("id",b.id);
          attr(v,{id:b.id,rx:AlienConstants.Radius,ry:AlienConstants.Radius});
          //v.classList.add("bullet")
          v.classList.add(b.viewType)
          svg.appendChild(v)
          return v;
        }
        
        const v = document.getElementById(b.id) || createAlienView();
        v.setAttribute("cx",String(b.x))
        v.setAttribute("cy",String(b.y))
      })
    
      s.exit.forEach(o=>{
        const v = document.getElementById(o.id);
        if(v) svg.removeChild(v)
      })
    }
}   
  // the following simply runs your pong function on window load.  Make sure to leave it in place.
  if (typeof window != 'undefined')
    window.onload = ()=>{
      spaceinvaders();
    }
  

//Object Movement
const moveObject = (o:Body) => <Body> {
  ...o,
  x: torusWrap(o.x + o.xspeed),
  y: o.y + o.yspeed
}

const flipAlienDirection = (o:Body) => <Body>{
  ...o,
  xspeed: -o.xspeed,
  y: o.y + AlienConstants.DownJumpOffset 
}
// Screen Wrapper
const torusWrap = (x: number) : number => { 
  const s=Constants.CanvasSize, 
    wrap = (v:number) => v < 0 ? v + s : v > s ? v - s : v;
  return wrap(x)
}





/**
 * set a number of attributes on an Element at once
 * @param e the Element
 * @param o a property bag
 */         
 const attr = (e:Element,o:Object) =>
 { for(const k in o) e.setAttribute(k,String(o[k])) }


 const collisionDetector = (firstBody:Body, secondBody: Body)=>{
  const x = firstBody.x - secondBody.x;
  const y = firstBody.y - secondBody.y;
  return Math.sqrt(x*x + y*y)
 }

 /**
 * array a except anything in b
 * @param eq equality test function for two Ts
 * @param a array to be filtered
 * @param b array of elements to be filtered out of a
 */ 
  const except = 
    <T>(eq: (_:T)=>(_:T)=>boolean)=>
      (a:ReadonlyArray<T>)=> 
        (b:ReadonlyArray<T>)=> a.filter(not(elem(eq)(b)))

  /**
 * Composable not: invert boolean result of given function
 * @param f a function returning boolean
 * @param x the value that will be tested with f
 */
  const not = <T>(f:(x:T)=>boolean)=> (x:T)=> !f(x)

  /**
   * is e an element of a using the eq function to test equality?
 * @param eq equality test function for two Ts
 * @param a an array that will be searched
 * @param e an element to search a for
 */
  const elem = 
    <T>(eq: (_:T)=>(_:T)=>boolean)=> 
      (a:ReadonlyArray<T>)=> 
        (e:T)=> a.findIndex(eq(e)) >= 0

  
/**
 * apply f to every element of a and return the result in a flat array
 * @param a an array
 * @param f a function that produces an array
 */
function flatMap<T,U>(
  a:ReadonlyArray<T>,
  f:(a:T)=>ReadonlyArray<U>
): ReadonlyArray<U> {
  return Array.prototype.concat(...a.map(f));
}

//
class RNG {
  // LCG using GCC's constants
  m = 0x80000000// 2**31
  a = 1103515245
  c = 12345
  state:number
  constructor(seed) {
    this.state = seed ? seed : Math.floor(Math.random() * (this.m - 1));
  }
  nextInt() {
    this.state = (this.a * this.state + this.c) % this.m;
    return this.state;
  }
  nextFloat() {
    // returns in range [0,1]
    return this.nextInt() / (this.m - 1);
  }
}