/* 
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */


function up(){
    //判断自己所在的位置 所在区域范围
    //来读取所需要检索的五个座位。

    var top = parseInt($('#mine').css("top"))+important_move_length+4;
    var window = parseInt($('.main-floor').height());

    var will_crash = [];

    if(top >= window * 0.8 ){
        will_crash = ['.number_19','.number_18','.number_17','.number_16','.number_15'];
    }else if(top >= window * 0.6){
        will_crash = ['.number_14','.number_13','.number_12','.number_11','.number_10'];
    }else if(top >= window * 0.4){
        will_crash = ['.number_9','.number_8','.number_7','.number_6','.number_5'];
    }else if(top >= window * 0.2){
        will_crash = ['.number_4','.number_3','.number_2','.number_1','.number_0'];
    }else if(top > 8){
        will_crash = [];
    }else{
        console.log('上一节车厢');
        return false;
    }

//            console.log(will_crash);
    var type = 'up';
    var length = will_crash.length;
    for(var i=0;i<length;i++){
//                console.log(console.log(will_crash))
        if(check(will_crash[i],type) === true){
            console.log('相交了');
            return false;
        }
    }
    //没相交的话就后退
    var go  = top - important_move_length*2 - 4;
    $('#mine').stop().animate({top:go+'px'},important_move_speed);
}

function down(){
    //判断自己所在的位置 + 自己的高 所在区域范围
    //来读取所需要检索的五个座位。

    var top = parseInt($('#mine').css("top"))-important_move_length-4;  
    var height = parseInt($('#mine').height());
    var max_bo = top + height;
    var window = parseInt($('.main-floor').height());

    var will_crash = [];
    if(max_bo > window - 8 ){
        console.log('下一节车厢');

        return false;
    }else if(max_bo >= window * 0.9){
        will_crash = [];
    }else if(max_bo >= window * 0.7){
        will_crash = ['.number_24','.number_23','.number_22','.number_21','.number_20'];
    }else if(max_bo >= window * 0.5){
        will_crash = ['.number_19','.number_18','.number_17','.number_16','.number_15'];
    }else if(max_bo >= window * 0.3){
        will_crash = ['.number_14','.number_13','.number_12','.number_11','.number_10'];
    }else if(max_bo >= window * 0.1){
        will_crash = ['.number_9','.number_8','.number_7','.number_6','.number_5'];
    }else{
        will_crash = ['.number_4','.number_3','.number_2','.number_1','.number_0'];
    }
    console.log(will_crash);
    var type = 'down';
    var length = will_crash.length;
    for(var i=0;i<length;i++){
//                console.log(check(will_crash[i],type));
        if(check(will_crash[i],type) === true){
            console.log('相交了');
            return false;
        }
    }
    //没相交的话就前进
    var go  = top + important_move_length*2 + 4;
    $('#mine').stop().animate({top:go+'px'},important_move_speed);
}

function left(){
    //判断自己所在的位置 所在区域范围
    //来读取所需要检索的五个座位。

    var left = parseInt($('#mine').css("left"))+important_move_length+4;  
    var window = parseInt($('.main-floor').width());

    var will_crash = [];
    if(left >= window * 0.7){
        will_crash = [];
    }else if(left >= window * 0.4){
        will_crash = ['.number_2','.number_7','.number_12','.number_17','.number_22'];
    }else if(left > 8){
        will_crash = [];
    }else{
        console.log('停止左走');
        return false;
    }

//            console.log(will_crash);
    var type = 'left';
    var length = will_crash.length;
    for(var i=0;i<length;i++){
        if(check(will_crash[i],type) === true){
            console.log('相交了');
            return false;
        }
    }
    //没相交的话就左走
    var go  = left - important_move_length*2 - 4;
    $('#mine').stop().animate({left:go+'px'},important_move_speed);
}

function right(){
    //判断自己所在的位置 所在区域范围
    //来读取所需要检索的五个座位。

    var left = parseInt($('#mine').css("left"))-important_move_length-4;
    var width = parseInt($('#mine').width());
    var max_ri = left + width;
    var window = parseInt($('.main-floor').width());

    var will_crash = [];
    if(max_ri > window - 8){
        console.log('停止右走');
        return false;
    }else if(left >= window * 0.7){
        will_crash = [];
    }else if(left >= window * 0.45){
        will_crash = ['.number_3','.number_8','.number_13','.number_18','.number_23'];
    }else if(left > 0){
        will_crash = [];
    }

//            console.log(will_crash);
    var type = 'right';
    var length = will_crash.length;
    for(var i=0;i<length;i++){
        if(check(will_crash[i],type) === true){
            console.log('相交了');
            return false;
        }
    }
    //没相交的话就左走
    var go  = left + important_move_length*2 + 4;
    $('#mine').stop().animate({left:go+'px'},important_move_speed);
}