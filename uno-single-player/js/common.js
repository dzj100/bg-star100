/** 
*　　　　　　　　┏┓　　　┏┓+ + 
*　　　　　　　┏┛┻━━━┛┻┓ + + 
*　　　　　　　┃　　　　　　　┃ 　 
*　　　　　　　┃　　　━　　　┃ ++ + + + 
*　　　　　　 ████━████  ┃+ 
*　　　　　　　┃　　　　　　　┃ + 
*　　　　　　　┃　　┻　  　　┃ 
*　　　　　　　┃　　　　　　　┃ + + 
*　　　　　　　┗━┓　　　┏━┛ 
*　　　　　　　　　┃　　　┃　　　　　　　　　　　 
*　　　　　　　　　┃　　　┃ + + + + 
*　　　　　　　　　┃　　　┃　　　　Code is far away from bug with the animal protecting　　　　　　　 
*　　　　　　　　　┃　　　┃ + 　　　　神兽保佑,代码无bug　　 
*　　　　　　　　　┃　　　┃ 
*　　　　　　　　　┃　　　┃　　+　　　　　　　　　 
*　　　　　　　　　┃　 　　┗━━━┓ + + 
*　　　　　　　　　┃ 　　　　　　　┣┓ 
*　　　　　　　　　┃ 　　　　　　　┏┛ 
*　　　　　　　　　┗┓┓┏━┳┓┏┛ + + + + 
*　　　　　　　　　　┃┫┫　┃┫┫ 
*　　　　　　　　　　┗┻┛　┗┻┛+ + + + 
*/

//判断这张牌能否打出
function canPushThisCard(color,face,boss,this_card){
    //完全一模一样可以打出
    if(color == important_card_color && face == important_card_face && important_setting_arr[1] == true){
        //两张一模一样的翻转牌 抢牌则“仅出牌” 当前位次选择“再翻转”or“仅出牌”
        // if(face == 'Reverse'){
        //     return true;
        // }else
        //惩罚结束 能打出一模一样的人 只能是当前玩家 其他玩家无法抢牌
        if(important_punish_done == 0 || boss == important_player_round){
            // playerActionCard(color,face,boss,this_card);
            if(important_punish_arr.length == 0){
                return true;
            }else if(important_punish_arr.length != 0 && important_setting_arr[0] == true){
                return true;
            }
        }
    }
    //花色一样或者数字一样可以打出
    if(color == important_card_color || face == important_card_face){
        if(boss == important_player_round){
            if(important_punish_arr.length == 0){
                // playerActionCard(color,face,boss,this_card);
                return true;
            }else if(important_card_face == face && important_setting_arr[0] == true){
                return true;
            }
        }
    }
    //黑色
    if(color == 'black'){
        //当前回合且没有叠加的时候 如果叠加了 只能打+4
        if(boss == important_player_round || important_player_round === ''){
            if(important_punish_arr.length == 0){
                // playerActionCard(color,face,boss,this_card);
                return true;
            }else if(face == '+4' && important_setting_arr[0] == true){
                return true;
            }
        }
        //被Wild改成其他颜色之后黑色Wild可以打出
        else if(face == important_card_face && important_card_face == 'Wild'){
            // playerActionCard(color,face,boss,this_card);
            return true;
        }
        //被+4改成其他颜色之后黑色+4可以打出
        else if(face == important_card_face && important_card_face == '+4'){
            if(important_punish_done != 2 || boss == important_player_round){
                // playerActionCard(color,face,boss,this_card);
                return true;
            }
        }
    }
    //十·律动
    if(important_setting_arr[4] == true && boss == important_card_boss && color == important_card_color){
        for(var i = 1; i < 10; i++){
            if(face == String(i) && important_card_face == String(10 - i) ){
                // console.log('达成十·律动条件');
                important_player_heshi = true;
                return true;
            }
        }
    }
}

//倒计时条
function beoverAnimate(time){
    var haomiao = time;
    $('#beover-absolute').show().stop().css({width:'100%'}).animate({width:'0'},haomiao,'linear',function(){
        $('#beover-absolute').css({display:'none'});
    });
}

//全局变量 - 出牌音效
var chupaiyinxiao = {
    cpWrap : [],
    cpAudio: function (){
        var arr = [
            'music/cp1.mp3',
            'music/cp2.mp3',
            'music/cp3.mp3',
            'music/cp4.mp3',
            'music/cp5.mp3',
            'music/winner.mp3',
        ];
        
        for(var i =0; i< arr.length ;i++) {
            chupaiyinxiao.cpWrap[i] = new Audio(arr[i]);
        }
        return chupaiyinxiao.cpWrap;
    }
};

//vip起手手牌
function vipModel(library){
    var player_number = important_player_arr.length;
    var get_arr = [];
    var where = [];
    for (var i = 0; i < library.length; i++) {
        if(library[i][1] == '+2'){
            get_arr.push(i);
        }else if(library[i][0] == 'black'){
            get_arr.push(i);
        }
        if(get_arr.length == 7){
            break;
        }
    }
    for (var b = 0; b < 7; b++) {
        where.push(b*player_number);
    }
    for (var c = 0; c < 7 ;c++) {
        var arr = library[where[c]] ;
        library[where[c]] = library[get_arr[c]] ;
        library[get_arr[c]] = arr ;
    }
    return library;
}

//彩蛋之黄子韬和静香
function eggshellFztWithJx(pjid){
    var find_name = '';
    var sel_num = parseInt( $(pjid).parents('.other-player-table').find('.other-player-card-num').html() );
    var his_num = 0;
    var $his = '';
    if($(pjid).html() == '瑾香'){
        find_name = '房子韬';
    }else if($(pjid).html() == '房子韬'){
        find_name = '瑾香';
    }
    $('.other-player-info-name').each(function(){
        if($(this).html() == find_name){
            his_num = parseInt( $(this).parents('.other-player-table').find('.other-player-card-num').html() );
            $his = $(this);
        }
    });
    //比较少的一方说加油
    if(sel_num < his_num){
        $(pjid).parents('.other-player-address').addClass('painted-eggshell-jiayou');
        $his.parents('.other-player-address').addClass('painted-eggshell-tanqi');
    }else{
        $(pjid).parents('.other-player-address').addClass('painted-eggshell-tanqi');
        if(his_num >= 4){
            $his.parents('.other-player-address').addClass('painted-eggshell-jiayou');
        }
    }

    setTimeout(function(){
        $('.painted-eggshell-tanqi').removeClass('painted-eggshell-tanqi');
        $('.painted-eggshell-jiayou').removeClass('painted-eggshell-jiayou');
    },9999);
}

/*2018年4月16日*/

function randomArray(arr){
    arr.sort(function(){
        return 0.5 - Math.random();
    });
    return arr;
}

function initPlaygroud(num){
    if(disable == 1){
        return;
    }
    disable = 1;
    var audio = document.getElementById('bgmusic');
    audio.play();
    $("#preface").fadeOut(300,function(){
        disable = 0;
    });
    var load = '';
    if(num == 9){
        num = Math.floor(Math.random()*6) + 3;
        important_player_vip = true;
    }
    switch (num){
        case 3: load = 'three'; break;
        case 4: load = 'four'; break;
        case 5: load = 'five'; break;
        case 6: load = 'six'; break;
        case 7: load = 'seven'; break;
        case 8: load = 'eight'; break;
        default: load = 'eight';
    }
    $('#playground-absolute').load('playground/'+load+'.html',function(){
        if(isWeiXin()){
            // var height = $('#playground-absolute').height();
            // $('#playground-absolute').css({height:height});
            // $('#playground-table').css({height:height});
            // var add_height = $('.other-player-table').eq(0).height();
            // $('.other-player-table').css({height:add_height});
            // $('#playground-table-put-area').css({height:$('#playground-table-put-area').height()});
            
            // var par_height = $('.other-player-table').eq(0).parent('td').height();
            // $('.other-player-table').each(function(){
            //     $(this).parent('td').css({height:par_height+'px'});
            // });
        }

        var image = ['CXJ','HZT','JX','KDY','MX','WJL','ZHANG','ZLY','STAR'];
        var name  = ['苍学姐','房子韬','瑾香','氪达鸭','莓西','丸健林','靓颖么么','萌萌丽颖','开发者'];
        var number= randomArray([0,1,2,3,4,5,6,7,8]);
        var url = '',
            html= '',
            player_number = num?num:8;
        for (var i = 0; i < number.length; i++) {
            if(i>=player_number){break;}
            url = 'url(./images/other-head-' + image[number[i]] + '.jpg)';
            html = name[number[i]];
            $('.other-player-table').eq(i).find('.other-player-head').css({'background-image':url});
            $('.other-player-table').eq(i).find('.other-player-info-name').html(html);
        }
        important_player_arr = new Array(player_number);
        initGameCards();
        
    });
}

function initGameCards(){
    var library_color = ['red','yellow','blue','green'];
    var library_face  = ['0','1','2','3','4','5','6','7','8','9','+2','Skip','Reverse'];
    var library_kind  = ['Wild','+4'];
    var library       = [];
    for (var i = 0; i < library_color.length; i++) {
        for (var j = 0; j < library_face.length; j++) {
            if (j==0) {
                library.push([library_color[i],library_face[j]]);
            }else{
                library.push([library_color[i],library_face[j]]);
                library.push([library_color[i],library_face[j]]);
            }
        }
    }
    for (var k = 0; k < library_kind.length; k++) {
        library.push(['black',library_kind[k]]);
        library.push(['black',library_kind[k]]);
        library.push(['black',library_kind[k]]);
        library.push(['black',library_kind[k]]);
    }
    library = randomArray(library);
    library = randomArray(library);
    
    if(important_player_vip == true){
        //vip模式
        library = vipModel(library);
        important_player_vip = false;
    }
    important_session_library = library;
    initPlayerCards(important_player_arr.length);
}

function getOneCard(){
    var card = important_session_library.splice(0,1);
    markCountJustNow();
    return card[0];
}

function initPlayerCards(player_number_input){
    var player_number = player_number_input?player_number_input:8;
    var number = 0;  //0是自己 顺时针1234567
    var player_card = [];
    var round = 0;
    var card  = [];
    var act   = setInterval(function(){
        if (round==0) {
            player_card[number] = [];   
        }
        card = getOneCard();
        player_card[number].push(card);
        if(number == 0){
            var element = '<div class="one-card '+card[0]+'" data-color="'+card[0]+'" data-face="'+card[1]+'" data-boss="0">'+card[1]+'</div>';
            $('#mine-handcard').append(element);
        }else{
            $('#element'+number).parents('.other-player-table').find('.other-player-card-num').html(round+1);
        }
        number ++;
        if(number == player_number){
            round ++;
            number = 0;
        }
        if(round == 7){
            clearInterval(act);
            randomSomeoneBegin();
        }
        important_session_player_card = player_card;
    },50);
}

function randomSomeoneBegin(){
    var begin = 0;
    var round = 0;  //2的时候停
    var player = important_player_arr.length;           //共8个玩家 则为8
    var rand = Math.floor(player*Math.random());        //0~player player=4 则[0,4)整数 0 1 2 3
    var act = setInterval(function(){
        $('.other-player-table').removeClass('round-highlight');
        $('#mine-absolute').removeClass('round-highlight');
        if (begin == 0) {
            $('#mine-absolute').addClass('round-highlight');
        }else{
            $('#element'+begin).parents('.other-player-table').addClass('round-highlight');
        }
        if (round == 2 && begin == rand) {
            clearInterval(act);
            important_player_round = rand;
            // console.log('即将摸取开局第一张牌');
            getFirstCardActionGame();
        }
        begin ++;
        if (begin == player) {
            begin = 0;
            round ++;
        }
   },100);
}

function getFirstCardActionGame(){
    var card = [];
    while(1){
        card = getOneCard();
        if(card[1] == '+4'){
            important_session_library.push(card);
            important_session_library = randomArray(important_session_library);
        }else{
            break;
        }
    }
    important_session_discard.push(card);
    var transform_deg = Math.floor(90*(0.5-Math.random()));
    var card_element  = '<div class="one-card one-card-just-now '+card[0]+'" style="left:50%;top:50%;transform:translate(-50%,-50%) rotate('+transform_deg+'deg);" data-face="'+card[1]+'">'+card[1]+'</div>';
    $('#playground-table-put-area').append(card_element);
    important_card_color = card[0];
    important_card_face = card[1];
    important_card_boss = important_player_round;
    switch(card[1]){
        case '+2':
                var i = important_punish_arr.length;
                important_punish_arr[i] = i;
                important_punish_arr[i+1] = i+1;
                important_punish_timer = setTimeout(function(){
                    punishPlayerGetCards();
                },5000);
                beoverAnimate(5000);
                // console.log('五秒钟之后接受惩罚：'+important_punish_arr.length);
                punishTipShowEveryone();
            break;
        case 'Reverse':
                markOrderJustNow();
            break;
        case 'Skip':
                var short = important_player_round;
                important_player_round = -1;
                setTimeout(function(){
                    markPlayerJustNow(short);
                },500);
            break;
        case 'Wild':
                changeAndLookMine(important_player_round);
                if(important_player_round == 0){
                    $('#shadow').fadeIn(200);
                    important_close_timer = setTimeout(function(){
                        automaticClick("shadow");
                    },5000);
                    beoverAnimate(5000);
                }else{
                    showShadowOther(important_card_boss);
                    important_close_timer = setTimeout(function(){
                        automaticClick("shadow");
                    },500);
                }
            break;
        default:
            if(important_player_round != 0){
                if($('#element'+important_player_round).html() == '苍学姐'){
                    var time = 4500 - important_setting_speed * 30;
                    $('#element'+important_player_round).parents('.other-player-address').addClass('painted-eggshell-xuejie');
                    setTimeout(function(){
                        $('.painted-eggshell-xuejie').removeClass('painted-eggshell-xuejie');
                    },time);
                }
            }
            
    }
    computerScript();
    if(important_player_order == '++'){
        $('#bg-rotate-absolute').addClass('bg-rotate-ssz');
    }else if(important_player_order == '--'){
        $('#bg-rotate-absolute').addClass('bg-rotate-nsz');
    }
}

$('#mine-handcard').on("click",".one-card",function(){
    var this_card = $(this);
    var color = this_card.attr('data-color');
    var face = this_card.attr('data-face');
    var boss = this_card.attr('data-boss');
    if(boss == ''){
        return false;
    }
    if(lastoneCantBlack(this_card) == false){
        // alert('黑牌不可以作为最后一张打出噢');
        $('#mine-handcard').addClass('last-dont-black');
        setTimeout(function(){
            $('#mine-handcard').removeClass('last-dont-black');
        },1500);
        touchOneCard(0);
        return false;
    }
    if(canPushThisCard(color,face,boss,this_card) === true){
        $('#warmtips-animate').hide();
        if(face == 'Reverse' && color == important_card_color && face == important_card_face){
            if(boss != important_player_round){
                var isSuccess = playerActionCard(color,face,boss,this_card);
                if(isSuccess == true){
                    markOrderJustNow();
                    markPlayerJustNow(boss);
                }
            }else if(boss == important_player_round){
                $('#reverse').show();
                important_close_timer = setTimeout(function(){
                    automaticClick("reverse");
                },5000);
                beoverAnimate(5000);
            }
        }else{
            playerActionCard(color,face,boss,this_card);
        }
    }
});

function computerAction(){
    var color = '';
    var face  = '';
    var this_card = null;
    var boss  = important_player_round;
    var now_hand = important_session_player_card[boss];
    var can_arr = [];
    for (var i = 0; i < now_hand.length; i++) {
        color = now_hand[i][0];
        face  = now_hand[i][1];
        if(now_hand.length == 1 && color == 'black'){
            touchOneCard(boss);
            return;
        }
        if(canPushThisCard(color,face,boss,this_card) === true){
            can_arr.push([color,face,boss,this_card]);
        }
    }
    if(can_arr.length == 0){
        touchOneCard(boss);
    }else{
        var put = randomArray(can_arr)[0];
        color = put[0];
        face = put[1];
        if(face == 'Reverse' && color == important_card_color && face == important_card_face){
            if(boss != important_player_round){
                var isSuccess = playerActionCard(color,face,boss,this_card);
                if(isSuccess == true){
                    markOrderJustNow();
                    markPlayerJustNow(boss);
                }
            }else if(boss == important_player_round){
                $('#reverse').show();
                important_close_timer = setTimeout(function(){
                    automaticClick("reverse");
                },500);
            }
        }else{
            playerActionCard(color,face,boss,this_card);
        }
    }
}

function computerScript(){
    clearTimeout(important_computer_timer);
    var fortime = 4800 - important_setting_speed * 30 ;
    if(fortime>=4800){fortime=4800;}
    important_computer_timer = setTimeout(function(){
        if($('#epilogue').css('display') == 'block'){
            return;
        }
        computerScript();
        
        if(important_player_rest == 0 && important_player_round == 0){
            if($('#mine-operate').hasClass('mine-sayuno')){
                //@TODO 电脑牢骚
            }else{
                if(important_someone_sayuno == '11'){
                    important_someone_sayuno = '00';
                }
            }
            if($('#shadow').css('display') != 'block' && $('#shadow-other').css('display') != 'block'){
                if(autoRobberyCard() == true){
                    //响应自动抢牌
                    return;
                }
            }
            if($('#shadow').css('display') != 'block' && $('#punishnum').css('display') != 'block' && $('#shadow-other').css('display') != 'block'){
                
                $('#warmtips-animate').show();
                setTimeout(function(){
                    $('#warmtips-animate').hide();
                },1100);
            }
            return;
        }
        if($('#shadow').css('display') == 'block' || $('#reverse').css('display') == 'block' || $('#shadow-other').css('display') == 'block'){
            // console.log('computer stop');
            return;
        }
        
        // console.log('computer start');
        if(important_someone_sayuno == '10'){
            important_someone_sayuno = '00';
            // console.log('---------------记录00---------------');
            if(cardOnlyOneNoSayUno() === false){
                //不检举
            }else{
                return;
            }
        }else if(important_someone_sayuno == '11'){
            important_someone_sayuno = '00';
            // console.log('---------------记录00---------------');
        }
        if(autoRobberyCard() == true){
            //响应自动抢牌
            return;
        }
        if(important_player_round == 0){
            if(important_player_rest == 1){
                mineHaveRest();
            }
            return;
        }
        
        computerAction();
    },fortime);
}

function cardOnlyOneNoSayUno(whofind){
    var yon = Math.random();
    if(whofind==0){yon=1;}
    if(important_session_player_card[important_card_boss].length != 1){
        computerScript();
        return false;
    }
    if(yon<0.25){
        // console.log('剩余一张但是电脑不检举！')
        return false;
    }else{
        // console.log('检举上一家没说uno！');
//        $('#issayuno').slideDown(200);
        $('#issayuno').addClass('issayuno-shake');
        setTimeout(function(){
            $('#issayuno').removeClass('issayuno-shake');
        },1800);
    }
    if(important_punish_arr.length != 0){
        clearTimeout(important_punish_timer);
        important_punish_timer = setTimeout(function(){
            punishPlayerGetCards();
        },4000);
        beoverAnimate(4000);
    }
    clearTimeout(important_computer_timer);
    var pjid = '#element'+important_card_boss;
    
    if(important_card_boss == 0){
        pjid = '#mine-handcard';
    }
    for (var i = 0; i < 2; i++) {
        var data = getOneCard();
        important_session_player_card[important_card_boss].push(data);
        if(important_card_boss != 0){
            setTimeout(function(){
                var animate = '<div class="one-card-touch-animate one-card otherplayer"></div>';
                $(pjid).parents('.other-player-table').append(animate);
            },i*300);
        }else{
            var newCard = '<div class="one-card '+data[0]+'" data-color="'+data[0]+'" data-face="'+data[1]+'" data-boss="0">'+data[1]+'</div>';
            $(pjid).append(newCard);
        }
    }
    if(important_card_boss != 0){
        var number = important_session_player_card[important_card_boss].length;
        $(pjid).parents('.other-player-table').find('.other-player-card-num').html(number);
    }
    setTimeout(function(){
        $('.one-card-touch-animate').remove();
        computerScript();
    },1050);
}

var disable = 0;
function touchOneCard(player){
    
    if(player == important_player_round && important_punish_arr.length == 0 && disable == 0){
        
        var card = getOneCard();
        important_session_player_card[player].push(card);
        if(player == 0){
            if(important_someone_sayuno == '11'){
                $('#mine-handcard').addClass('sayuno-dont-touch');
                setTimeout(function(){
                    $('#mine-handcard').removeClass('sayuno-dont-touch');
                },1500);
                return;
            }
            var element = '<div class="one-card '+card[0]+'" data-color="'+card[0]+'" data-face="'+card[1]+'" data-boss="0">'+card[1]+'</div>';
            $('#mine-handcard').append(element);
            computerScript();
        }else{
            var animate = '<div class="one-card-touch-animate one-card otherplayer"></div>';
            if($('#element'+important_player_round).html() == '开发者'){
                animate = '<div class="one-card-touch-animate one-card otherplayer-vip"></div>';
            }
            
            $('#element'+player).parents('.other-player-table').append(animate);
            setTimeout(function(){
                $('.one-card-touch-animate').remove();
            },1000);
            var number = important_session_player_card[player].length;
            $('#element'+player).parents('.other-player-table').find('.other-player-card-num').html(number);
        }
        //如果可以出 则帮忙打出
        var color = card[0];
        var face = card[1];
        //花色一样或者数字一样或黑色 可以打出 
        if(color == important_card_color || face == important_card_face || color == 'black'){
            disable = 1;
            if(player == 0){
                var $short_card = $('#mine-handcard').find('.one-card').eq(-1);
                setTimeout(function(){
                    disable = 0;
                    $short_card.click();
                    var short_card = '<div class="one-card one-card-flashlight '+color+' short_card" ></div>';
                    $('#mine-handcard').append(short_card);
                },1000);
                setTimeout(function(){
                    $('.short_card').remove();
                },1200);
            }else{
                //AI出牌
                setTimeout(function(){
                    disable = 0;   
                },1900);
            }
        }
        //直接结束
        else{
            markPlayerJustNow(important_player_round);
        }
    }
}

function playerActionCard(color,face,boss,this_card){
    var card_arr = [color,face];
    var parent_arr = important_session_player_card[boss];
    var isExist = 0;
    for (var i = 0; i < parent_arr.length; i++) {
        if(parent_arr[i].toString() == card_arr.toString()){
            isExist ++;
        }
    }
    if(isExist == 0){
        // console.log('???没这张牌啊'+color+face);
        return;
    }
    important_session_discard.push(card_arr);
    for (var i = 0; i < important_session_player_card[boss].length; i++) {
        if(important_session_player_card[boss][i].toString() == card_arr.toString()){
            important_session_player_card[boss].splice(i,1);
            break;
        }
    }
    //零·最大
    if(face == '0' && important_setting_arr[3] == true){
        var face_arr = [];
        for (var j = important_session_player_card[boss].length-1; j >=0 ; j--) {
            if(important_session_player_card[boss][j][0] == color){
                face_arr.push(important_session_player_card[boss][j][1]);
                important_session_discard.push([color,important_session_player_card[boss][j][1]]);
                important_session_player_card[boss].splice(j,1);
            }
        }
        if(boss == 0){
            $('#mine-handcard').find('.one-card').each(function(){
                if($(this).attr('data-color') == color){
                    $(this).slideUp(500,function(){
                        $(this).remove();
                    });
                }
            });
            //console.log('我-打出零最大');
        }
        //动画
        lzdAnimate(boss,color,face_arr);
    }
    //十·律动
    if(important_setting_arr[4] == true && important_card_boss == boss && important_player_heshi){
        //前提，不经过别人回合，别人没牌出仅摸牌的情况。
        for (var i = 1; i < 10; i++) {
            if(i != 5 || important_setting_arr[1]){
                if(face == String(i) && important_card_face == String(10 - i) ){
                    card_last = [important_card_color,important_card_face];
                    card_new = [color,face];
                    heshiAnimate(card_last,card_new);
                    break;
                }
            }
        }
    }

    
    //执行记录牌的动作
    markCardJustNow(color,face,boss,this_card); 
    someoneBeWinner(boss);

    //做细节判断
    if(face == 'Reverse'){
        markOrderJustNow();
    }

    markPlayerJustNow(boss);
    
    if(color == 'black'){
        // $('#shadow-situation').html(getNowSituation());
        changeAndLookMine(boss);
        //启用一个十秒钟的倒计时定时器，时间一到，随机选中一个颜色点击。如果玩家点击，则定时器销毁。
        if(boss == 0){
            $('#shadow').fadeIn(200);
            important_close_timer = setTimeout(function(){
                automaticClick("shadow");
            },5000);
            beoverAnimate(5000);
            //动画5秒倒计时
        }else{
            showShadowOther(important_card_boss);
            important_close_timer = setTimeout(function(){
                automaticClick("shadow");
            },500);

        }
    }
    
    if(face == 'Skip'){
        markPlayerJustNow(important_player_round);
    }
    if(face == '+2'){
        //记录一个叠加数组 
        clearTimeout(important_punish_timer);
        var i = important_punish_arr.length;
        important_punish_arr[i] = i;
        important_punish_arr[i+1] = i+1;
        important_punish_timer = setTimeout(function(){
            punishPlayerGetCards();
        },5000);
        beoverAnimate(5000);
        // console.log('3+2秒钟之后接受惩罚：'+important_punish_arr.length);
        punishTipShowEveryone();
    }
    if(face == '+4'){
        //记录一个叠加数组
        clearTimeout(important_punish_timer);
        var i = important_punish_arr.length;
        important_punish_arr[i] = i;
        important_punish_arr[i+1] = i+1;
        important_punish_arr[i+2] = i+2;
        important_punish_arr[i+3] = i+3;
        // important_punish_timer = setTimeout('punishPlayerGetCards()',5000);
        // console.log('五秒钟之后接受惩罚：'+important_punish_arr.length);
        punishTipShowEveryone();
    }
    important_punish_done = 0;
    important_player_heshi = false;
    autoHeshi();
    return true;
}

$('.change-color-element').click(function(){
    if(disable != 0){
        return ;
    }else if(important_player_round != 0){
        
    }
    disable = 1;
    clearTimeout(important_close_timer);
    var this_element = $(this);
    this_element.siblings().css({opacity:'0.2'});
    this_element.css({opacity:'1'});
    var color = $(this).attr('data-color');
    // console.log('选择了颜色：'+color);
    important_card_color = color;
    if(important_card_face == '+4'){
        //弹窗检举 
        //important_punish_timer = setTimeout('punishPlayerGetCards()',5000);
        $('#check-up').show();
        if(important_player_round == 0){
            $('#shadow').show();
            $('#shadow').find('#change-color').hide();
            important_close_timer = setTimeout(function(){
                automaticClick("check-up");
            },5000);
            beoverAnimate(5000);
            //动画UI
        }else{
            var rand = Math.random()-0.5;
            if(important_setting_arr[2] == true){
                rand = -1;
            }
            if(rand<0){
                //不质疑
                setTimeout(function(){
                    $('#element'+important_player_round).parents('.other-player-address').addClass('someone-want-buzhiyi');
                    setTimeout(function(){
                        $('.someone-want-buzhiyi').removeClass('someone-want-buzhiyi');
                    },4000);
                    punishOpinion(0);
                },500);
            }else{
                //质疑
                setTimeout(function(){
                    $('#element'+important_player_round).parents('.other-player-address').addClass('someone-want-zhiyi');
                    setTimeout(function(){
                        $('.someone-want-zhiyi').removeClass('someone-want-zhiyi');
                    },4000);
                    punishOpinion(1);
                },500);
            }
        }
        
    }else{
        setTimeout(function(){
            shadowHidden(color);
        },2000);
        beoverAnimate(2000);
    }
});

function punishOpinion(how){
    if(important_setting_arr[2] == true && how == 1){
        return;
    }
    if(important_punish_done != 0){
        return;
    }else if(important_player_round != 0){
        
    }
    important_punish_done = 1;
    clearTimeout(important_close_timer);
    if(how == 0){
        $('#check-up').find('.check-up-button').eq(0).css({'opacity':'0.1'});
        //放弃检举 数秒之后将自动接受惩罚了
        setTimeout(function(){
            shadowHidden(important_card_color);
            important_punish_timer = setTimeout(function(){
                punishPlayerGetCards();
            },5000);
            beoverAnimate(5000);
        },1000);
    }else if(how == 1){
        $('#shadow').show();
        if(important_card_boss != 0 && important_player_round != 0){
            $('#shadow').find('#change-color').hide();
            $('#check-up').hide();
        }
        $('#check-up').find('.check-up-button').eq(1).css({'opacity':'0.1'});
        //进行检举
        $('#thistime-card').find('.one-card').removeClass('otherplayer').removeClass('otherplayer-vip');
        var bosshave = 0;
        var fourboss = important_card_boss;
        var lastcolor = $('#playground-table-put-area').find('.one-card').eq(-2).attr('class');
        lastcolor = lastcolor.split(" ").pop();
        // console.log('质疑他有'+lastcolor);
        $('#thistime-card').find('.one-card').each(function(){
            if($(this).attr('data-color') == lastcolor){
                $(this).css({transform:'translate(0,-0.5rem)'});
                bosshave++;
            }
        });

        if(bosshave!=0){
            //检举成功 打出+4的人自己摸牌
            important_player_round = fourboss;
            punishPlayerGetCards();
        }else{
            //检举失败 当前玩家多摸取两张
            var i = important_punish_arr.length;
            important_punish_arr[i] = i;
            important_punish_arr[i+1] = i+1;
            punishPlayerGetCards();
        }
        setTimeout(function(){
            shadowHidden(important_card_color);
        },5000);
        beoverAnimate(5000);
    }
}

function shadowHidden(color){
    disable = 0;
    $('#check-up').hide();
    $('#check-up').find('.check-up-button').css({'opacity':'1'});
    $('#shadow-other').hide();
    $('#shadow').hide();
    $('#shadow').find('#change-color').show();
    // $('#shadow-situation').html('');
    $('#thistime-card').html('');
    $('#playground-table-put-area').find('.one-card').eq(-1).addClass(color);
    $('.change-color-element').css({opacity:'1'});
}

function reverseOpinion(how){
    
    clearTimeout(important_close_timer);
    if(how == 0){
        $('#reverse-opinion').find('.reverse-opinion-element').eq(0).css({opacity:'0.1'});
    }else if(how == 1){
        $('#reverse-opinion').find('.reverse-opinion-element').eq(1).css({opacity:'0.1'});
    }
    $('#reverse').fadeOut(1000,function(){
        $('.reverse-opinion-element').css({opacity:'1'});
        computerScript();
    });

    var color = important_card_color;
    var face = important_card_face;
    var boss = important_player_round;
    var this_card = '';
    var pjid = '';
    if(boss == 0){
        pjid = '#mine-handcard';
        $(pjid).find('.one-card').each(function(){
            if($(this).attr('data-color') == color && $(this).attr('data-face') == face){
                this_card = $(this);
            }
        });
    }else{
        this_card = null;
    }
    
    var isSuccess = playerActionCard(color,face,boss,this_card);
    if(how == 1){
        //跟牌
        if(isSuccess == true){
            markOrderJustNow();
            markPlayerJustNow(boss);
        }
    }
}

function punishTipShowEveryone(){
    var num = important_punish_arr.length;
    $('#punishnum-tip').html(num);
    if($('#punishnum').css('display') != 'block'){
        $('#punishnum').show().css({'opacity':'0','top':'1rem'}).animate({'opacity':'1','top':'5.5rem'},400,'swing',function(){
            $('#punishnum').animate({'top':'5rem'},100);
        });
    }else{
        if($('#punishnum').css('opacity') == '0.99' || $('#punishnum').css('opacity') == '0.5'){
            setTimeout(function(){
                punishTipShowEveryone();
            },50);
            return;
        }
        $('.punishnum_clone').remove();
        var $clone = $('#punishnum').clone();
        $clone.addClass('punishnum_clone').css({'z-index':'+=1'});
        $("body").append($clone);
        setTimeout(function(){
            $clone.css({'transform':'scale(2)','opacity':'0','transition':'all .35s'});
        },10);
        setTimeout(function(){
            $clone.hide();
        },360);
    }
}

function punishTipHidden(){
    if($('#punishnum').css('display') != 'block'){
        return;
    }
    $('.punishnum_clone').remove();
    $('#punishnum').css({'transform':'scale(1.2)','transition':'all .15s','opacity':'0.99'})
    setTimeout(function(){
        $('#punishnum').css({'transform':'scale(0)','opacity':'0.5'});
    },150);
    setTimeout(function(){
        $('#punishnum').css({'transform':'scale(1)','transition':'none','opacity':'1','display':'none'});
        $('#punishnum-tip').html(0);
    },300);
}

function markCountJustNow(){
    var num = important_session_library.length;
    $('#cardscount-i').html(num);
    //当剩余0张的时候 将桌面清空 仅保留最后一张牌
    if(num == 0){
        var $card = $('#playground-table-put-area').find('.one-card').eq(-1);
        var arr_element = important_session_discard.pop();
        important_session_library = randomArray(important_session_discard);
        important_session_discard = [arr_element];
        $('#playground-table-put-area').html($card);
        num = important_session_library.length;
        $('#cardscount-i').html(num);
    }
}

function markCardJustNow(color,face,boss,this_card){
    if(important_player_music == true){
        chupaiyinxiao.cpWrap[Math.floor(Math.random()*5)].play();
    }

    if($('#playground-table-put-area').find('.one-card').length >= 18){
        var $noone = $('#playground-table-put-area').find('.one-card').eq(-18);
        $noone.fadeOut(500,function(){
            $noone.removeClass('red').removeClass('yellow').removeClass('blue').removeClass('green').removeClass('black');
        });
    }
    $('#playground-table-put-area').find('.one-card-just-now').removeClass('one-card-just-now');
    important_card_color = color;
    important_card_face = face;
    important_card_boss = boss;

//    var cha_width       = ($(window).width() - $(document.body).width()) / 2;
    var left_or_right   = randomArray(['left','right'])[0];
    var top_or_bottom   = randomArray(['top','bottom'])[0];
    var x_zuobiao       = Math.floor(30*Math.random())+20;
    var y_zuobiao       = Math.floor(30*Math.random())+20;
    var transform_deg   = Math.floor(75*(0.5-Math.random()));

    
    if($('#playground-table-put-area').find('.one-card').length < 20){
        var card_element  = '<div class="one-card one-card-just-now '+color+'" style="'+left_or_right+':'+x_zuobiao+'%;'+top_or_bottom+':'+y_zuobiao+'%;transform:rotate('+transform_deg+'deg);" data-face="'+face+'">'+face+'</div>';
        $('#playground-table-put-area').append(card_element);
    }else{
        var $first = $('#playground-table-put-area').find('.one-card').eq(0);
        $first.css({left_or_right:x_zuobiao+'%',top_or_bottom:y_zuobiao+'%'}).attr('data-face',face).addClass(color).addClass('one-card-just-now').html(face).show();
        $('#playground-table-put-area').append($first);
    }

    if(boss !=0 && boss !=''){
        var number = important_session_player_card[boss].length;
        $('#element'+boss).parents('.other-player-table').find('.other-player-card-num').html(number);
        if(number == 1 && Math.random()<0.75){
            $('#element'+boss).parents('.other-player-address').addClass('other-sayuno');
            important_someone_sayuno = '11';
            setTimeout(function(){
                $('.other-sayuno').removeClass('other-sayuno');
            },1799);
            // console.log('电脑喊了uno');
        }
        // console.log(boss+'号玩家的剩余手牌：'+number);
    }else{
        computerScript();
    }
    //记录该玩家没有说UNO
    if(important_someone_sayuno != '11' && important_session_player_card[important_card_boss].length == 1){
        // console.log('**************记录10**************');
        important_someone_sayuno = '10';
    }
    //清除自身UNO气泡
    if($('#mine-operate').hasClass('mine-sayuno')){
        setTimeout(function(){
            $('#mine-operate').removeClass('mine-sayuno');
        },1799);
    }

    if(this_card != null){
        this_card.remove();
    }
    
    // console.log('记录情况'+color,face,boss);
}

function markPlayerJustNow(boss){
    //当前玩家boss出牌之后 记录下一位出牌的是哪一个玩家
    important_player_round = Number(boss);
    var player_number = important_player_arr.length;
    if(important_player_order == '++'){
        var next = important_player_round + 1 ;
        if(next == player_number){
            important_player_round = 0;
        }else{
            important_player_round = next;
        }
    }else if(important_player_order == '--'){
        var last = important_player_round - 1;
        if(last == -1){
            important_player_round = player_number-1;
        }else{
            important_player_round = last;
        }
    }
    // console.log('轮到玩家：'+important_player_round);
    $('.other-player-table').removeClass('round-highlight');
    $('#mine-absolute').removeClass('round-highlight');

    if(important_player_round == 0) {
        $('#mine-absolute').addClass('round-highlight');
    }else{
        $('#element'+important_player_round).parents('.other-player-table').addClass('round-highlight');
    }

    if(important_session_player_card[0].length <= 3){
        $('#mine-operate-sayuno').show();
    }else{
        $('#mine-operate-sayuno').hide();
    }
}

function markOrderJustNow(){
    //记录当前出牌顺序是顺还是逆
    if(important_player_order == '++'){
        important_player_order = '--';
        $('#bg-rotate-absolute').removeClass('bg-rotate-ssz');
        $('#bg-rotate-absolute').addClass('bg-rotate-nsz');
    }else if(important_player_order == '--'){
        important_player_order = '++';
        $('#bg-rotate-absolute').removeClass('bg-rotate-nsz');
        $('#bg-rotate-absolute').addClass('bg-rotate-ssz');
    }
    // console.log('出牌顺序：'+important_player_order);
}

function punishPlayerGetCards(){
    
    important_punish_done = 2;
    // console.log('确认惩罚：'+important_punish_arr.length);
    clearTimeout(important_computer_timer);
    var pjid = '#element'+important_player_round;
    var _time = '';
    if(important_player_round == 0){
        pjid = '#mine-handcard';
    }
    for (var i = 0; i < important_punish_arr.length; i++) {
        var data = getOneCard();
        important_session_player_card[important_player_round].push(data);
        if(important_player_round != 0){
            setTimeout(function(){
                var animate = '<div class="one-card-touch-animate one-card otherplayer"></div>';
                if($(pjid).html() == '开发者'){
                    animate = '<div class="one-card-touch-animate one-card otherplayer-vip"></div>';
                }
                $(pjid).parents('.other-player-table').append(animate);
                clearTimeout(_time);
                _time = setTimeout(function(){
                    $('.one-card-touch-animate').remove();
                    computerScript(); //胜利结算后不再开始放到了script中
                },750);
            },i*100);
            
        }else{
            var newCard = '<div class="one-card '+data[0]+'" data-color="'+data[0]+'" data-face="'+data[1]+'" data-boss="'+important_player_round+'">'+data[1]+'</div>';
            $(pjid).append(newCard);
        }
    }
    if(important_player_round != 0){
        var number = important_session_player_card[important_player_round].length;
        $('#element'+important_player_round).parents('.other-player-table').find('.other-player-card-num').html(number);
        //painted-eggshell
        if(important_punish_arr.length >=6 && important_session_player_card[important_player_round].length >=10 && $(pjid).html() =='丸健林'){
            $(pjid).parents('.other-player-address').addClass('painted-eggshell-wjl');
            setTimeout(function(){
                $('.painted-eggshell-wjl').removeClass('painted-eggshell-wjl');
            },10000);
        }else if(important_punish_arr.length >=8){
            if($(pjid).html() =='瑾香' || $(pjid).html() =='房子韬'){
                eggshellFztWithJx(pjid);    
            }
        }
    }else{
        computerScript();//胜利结算后不再开始放到了script中
    }
    important_punish_arr = [];
    punishTipHidden();
    markPlayerJustNow(important_player_round);
}

function lastoneCantBlack(this_card){
    var boss = this_card.attr('data-boss');
    var color = this_card.attr('data-color');
    if(color == 'black' && important_session_player_card[boss].length == 1){
        return false;
    }
}

function changeAndLookMine(boss){
    $('#thistime-card').html('');
    var pjid = '#element'+boss;
    var content = '';
    if(boss == 0){
        pjid = '#mine-handcard';
        content = $(pjid).html();
    }else{
        var now_hand = important_session_player_card[boss];
        for (var i = 0; i < now_hand.length; i++) {
            content += '<div class="one-card '+now_hand[i][0]+'" data-color="'+now_hand[i][0]+'" data-face="'+now_hand[i][1]+'" data-boss="'+important_player_round+'">'+now_hand[i][1]+'</div>';
        }
    }
    
    $('#thistime-card').html(content);
    if(boss != 0){
        if($(pjid).html() == '开发者'){
            $('#thistime-card').find('.one-card').addClass('otherplayer-vip');
        }else{
            $('#thistime-card').find('.one-card').addClass('otherplayer');
        }
    }
}

function automaticClick(id) {
    if(id == 'shadow'){
        //随机选择颜色
        var where = Math.floor(Math.random()*4);
        if($('#shadow-other').css('display') != 'block'){
            where += 4;
        }
        $('.change-color-element').eq(where).click();
    }
    if(id == 'check-up'){
        //默认不检举
        punishOpinion(0);
    }
    if(id == 'reverse'){
        //默认仅出牌
        $('#reverse-opinion').find('.reverse-opinion-element').eq(1).click();
    }
}

function someoneBeWinner(boss){
    var num = important_session_player_card[boss].length;
    if(num == 0){
        // console.log(boss+'号玩家获胜!!!');
        clearTimeout(important_computer_timer);
        winnerShowEveryone(boss);
    }
}

function winnerShowEveryone(boss){
    if(important_player_music == true){
        chupaiyinxiao.cpWrap[5].play();
        var audio = document.getElementById('bgmusic'); 
        setTimeout(function(){
            audio.pause();
        },500);
        setTimeout(function(){
            audio.play();
        },6700);
    }
    
    $('#epilogue').fadeIn(1000);
    var window_width = $(window).width();
    var body_width   = $(document.body).width();
    var cha_width    = (window_width - body_width) / 2;
    // // console.log(cha_width)
    if(boss!=0){
        var pjid = '#element'+boss;
        var $address = $(pjid).parents('.other-player-table').find('.other-player-address');
    }else{
        var pjid = '#mine-operate';
        var $address = $(pjid).find('#mine-operate-address');
    }
    var offset  = $address.offset();
    var top     = offset['top'];
    var left    = offset['left'] - cha_width;
    var width   = $address.width();
    var height  = $address.height();
    var $clone  = $address.clone();
    $clone.css({'width':width,'height':height,'top':top,'left':left,'position':'absolute','overflow':'inherit'});
    $('#epilogue').prepend($clone);
    var new_width   = width*2;
    var new_height  = height*2;
    var new_left    = (body_width - new_width) / 2;
    var new_top     = '18%';
    $clone.animate({'width':new_width,'height':new_height,'left':new_left,'top':new_top},2000);
    if(boss!=0){
        $clone.find('.other-player-info-name').prop('id','').css({'overflow':'inherit'}).animate({'font-size':'1.6rem'},2000);
    }else{
        $clone.find('#mine-operate-info').animate({'font-size':'1.5rem','line-height':'140%'},2000);
    }
    setTimeout(function(){
        $clone.append('<div id="epilogue-cap"></div>');    
        $('.epilogue-operate-button').fadeIn(200);
    },2000);
    
}

var mine_dblclick = 0;
$("#mine-handcard").click(function(){
    mine_dblclick ++;
    setTimeout(function(){mine_dblclick = 0;},300);
    if(mine_dblclick == 2){
        clearupHandCards();
        mine_dblclick = 0;
    }       
});

//整理手牌
function clearupHandCards(){
    var pjid = '#mine-handcard';
    var element_arr = [] ,
        color_arr   = [] ,
        red_arr     = [] ,
        yellow_arr  = [] ,
        blue_arr    = [] ,
        green_arr   = [] ,
        black_arr   = [] ,
        last_arr    = [] ,
        new_element = '';
    var by = function(name){
        return function(o, p){
            var a, b;
            if (typeof o === "object" && typeof p === "object" && o && p) {
                a = o[name];
                b = p[name];
                if (a === b) {
                    return 0;
                }
                if (typeof a === typeof b) {
                    return a < b ? -1 : 1;
                }
                return typeof a < typeof b ? -1 : 1;
            }
        };
    };
    $(pjid).find('.one-card').each(function(){
        element_arr.push($(this).prop("outerHTML"));
        color_arr.push(
            {'color':$(this).attr('data-color'),'face':$(this).attr('data-face')}
        );
    });
    for (var j = 0; j <color_arr.length; j++){
        switch (color_arr[j]['color']) {
            case 'red':
                red_arr.push({'key':j,'face':color_arr[j]['face']});
                break;
            case 'yellow':
                yellow_arr.push({'key':j,'face':color_arr[j]['face']});
                break;
            case 'blue':
                blue_arr.push({'key':j,'face':color_arr[j]['face']});
                break;
            case 'green':
                green_arr.push({'key':j,'face':color_arr[j]['face']});
                break;
            case 'black':
                black_arr.push({'key':j,'face':color_arr[j]['face']});
                break;
        }
    }
    black_arr.sort(by('face'));
    red_arr.sort(by('face'));
    yellow_arr.sort(by('face'));
    blue_arr.sort(by('face'));
    green_arr.sort(by('face'));

    last_arr = last_arr.concat(black_arr);
    last_arr = last_arr.concat(red_arr);
    last_arr = last_arr.concat(yellow_arr);
    last_arr = last_arr.concat(blue_arr);
    last_arr = last_arr.concat(green_arr);
    for (var k = 0; k < last_arr.length; k++) {
        new_element += element_arr[last_arr[k]['key']];
    }
    $(pjid).html(new_element);
}

function backGame(){
    // 重新加载页面 进行模式选择
    location.reload();
}

function onceGame(){
    // 不进行选择模式再次开局
    $('#mine-handcard').html('');
    $('#playground-table-put-area').html('');
    $('#mine-absolute').removeClass('round-highlight');
    $('#reverse').hide();
    $('.other-player-table').removeClass('round-highlight');
    $('#bg-rotate-absolute').removeClass('bg-rotate-ssz').removeClass('bg-rotate-nsz');
    punishTipHidden();
    shadowHidden(important_card_color);
    
    important_session_library = [];
    important_session_discard = [];
    important_session_player_card = [];
    important_card_color = ''; 
    important_card_face = ''; 
    important_card_boss = ''; 
    important_player_round = ''; 
    important_punish_arr = []; 
    important_punish_timer = ''; 
    important_close_timer = ''; 
    important_punish_done = 0; 
    important_computer_timer = ''; 
    
    $('#epilogue').fadeOut(500,function(){
        $('#epilogue').html('<div id="epilogue-operate"><div class="epilogue-operate-button green" onclick="onceGame();">再次游戏</div><div class="epilogue-operate-button green" onclick="backGame();">模式选择</div></div>');
        initGameCards();
    });
}


function sayUnoToEveryone(who){
    var now_hand = important_session_player_card[who];
    if(now_hand.length>2){
        return;
    }
    if(important_player_round == who){
        if(now_hand.length == 2){
            var color = '',face = '',boss = who,this_card = null;
            for (var i = 0; i < now_hand.length; i++) {
                color = now_hand[i][0];
                face  = now_hand[i][1];
                if(canPushThisCard(color,face,boss,this_card) === true){
                    important_someone_sayuno = '11';
                    if(who == 0){
                        $('#mine-operate').addClass('mine-sayuno');
                    }
                    break;
                }
            }
        }
    }else if(important_card_boss == who){
        if(now_hand.length == 1 && important_someone_sayuno == '10'){
            important_someone_sayuno = '11';
            if(who == 0){
                $('#mine-operate').addClass('mine-sayuno');
                $('.other-player-info-name').each(function(){
                    if($(this).html() == '开发者'){
                        if(parseInt($(this).parents('.other-player-table').find('.other-player-card-num').html()) >= 4){
                            $(this).parents('.other-player-address').addClass('painted-eggshell-star');
                            setTimeout(function(){
                                $('.painted-eggshell-star').removeClass('painted-eggshell-star');
                            },10000);
                        }
                    }
                });
            }
        }
    }

}

$('#playground-absolute').on("click",".other-player-address",function(){
    var $element = $(this);
    var id = $element.find('.other-player-info-name').attr('id').replace('element','');
    var num = important_session_player_card[id].length;
//    var num = $element.parents('.other-player-table').find('.other-player-card-num').html();
    // console.log('这个玩家还剩下'+num+'张手牌');
    if(num == 1 && important_someone_sayuno == '10'){
        // console.log('0号玩家发现上家没说uno！');
        important_someone_sayuno = '00';
        // console.log('---------------记录00---------------');
        cardOnlyOneNoSayUno(0);
        return;
    }
});

function mineHaveRest(){
    var color = '',face = '',boss = 0,this_card = null,can_arr = [];
    $('#mine-handcard').find('.one-card').each(function(){
        color = $(this).attr('data-color');
        face  = $(this).attr('data-face');
        if(canPushThisCard(color,face,boss,this_card) === true){
            can_arr.push($(this));
        }
    });
    if(can_arr.length != 0){
        if($('#mine-handcard').find('.one-card').length == 2 && Math.random()<0.75){
            sayUnoToEveryone(0);
        }
        randomArray(can_arr)[0].click();
    }else{
        touchOneCard(0);
    }
}

function autoPlayCard(who){
    if(who == 0){
        if(important_player_rest == 0){
            $('#mine-operate-rest').css({opacity:'0.6'});
            important_player_rest = 1;
        }else if(important_player_rest == 1){
            $('#mine-operate-rest').css({opacity:'1'});
            important_player_rest = 0;
        }
        
    }
}

function helpGame(){
    computerScript();
    if($('.help-load-operate-close').html() === '×'){
        $('#help-absolute').show();
        return;
    }
    $('#help-absolute').load('playground/help.html',function(){
        $('#help-absolute').show();
    });
}

function preloadImage(){
    var arr = [
        'images/addfour2.png',
        'images/addtwo2.png',
        'images/bg.png',
        'images/bg-vip.png',
        'images/card8_2.png',
        'images/reverse.png',
        'images/skip.png',
        'images/wild.png',
        'images/winner.png',
        'images/other-head-CXJ.jpg',
        'images/other-head-HZT.jpg',
        'images/other-head-JX.jpg',
        'images/other-head-KDY.jpg',
        'images/other-head-MX.jpg',
        'images/other-head-MXLH.jpg',
        'images/other-head-WJL.jpg',
        'images/other-head-ZHANG.jpg',
        'images/other-head-ZLY.jpg',
        'images/other-head-STAR.jpg',
        'images/setting_lianxu.jpg',
        'images/setting_qiangduan.jpg',
        'images/setting_wusheng.jpg',
        'images/setting_zuida.jpg',
        'images/setting_heshi.jpg',
        'images/lzd-ling.png',
        'images/lzd-zui.png',
        'images/lzd-da.png',
    ];
    var imgWrap = [];
    for(var i =0; i< arr.length ;i++) {
        imgWrap[i] = new Image();
        imgWrap[i].src = arr[i];
    }
    chupaiyinxiao.cpAudio();
    return true;
}

if(preloadImage() == true){
    $('#loading-going').stop().animate({'width':'100%'},100,function(){
        $('#loading').hide();
    });
}

function musicSwitch(){
    var audio = document.getElementById('bgmusic'); 
    if(important_player_music == true){
        important_player_music = false;
        // 关闭
        audio.pause();
        $('#music-switch').addClass('music-switch-close');
    }else{
        important_player_music = true;
        // 开启
        $('#music-switch').removeClass('music-switch-close');
        audio.play();
    }
}

function audioAutoPlay(){  
    var audio = document.getElementById('bgmusic');  
    audio.play();  
    document.addEventListener("WeixinJSBridgeReady", function () {  
        audio.play();  
    }, false);  
    document.addEventListener('YixinJSBridgeReady', function() {  
        audio.play();  
    }, false);  
    setTimeout(function(){
        audio.play();
    },2000);
}

function getNowSituation(){
    var fighter = '',
        bfighter = '';
    if(important_card_boss == 0){
        fighter = $('#mine-operate-info').html();
    }else{
        fighter = $('#element'+important_card_boss).html();
    }

    if(important_player_round == 0){
        bfighter = $('#mine-operate-info').html();
    }else{
        bfighter = $('#element'+important_player_round).html();
    }

    var content = '[' + fighter + '] 对 [' + bfighter + '] 打出';
    if(fighter != undefined && bfighter != undefined){
        return content;
    }else{
        return '';
    }
}

function showShadowOther(who){
    $('#shadow-other').show();
    var pjid = '#element'+who;
    var window_width = $(window).width();
    var body_width   = $(document.body).width();
    var cha_width    = (window_width - body_width) / 2;
    if(who!=0){
        var $address = $(pjid).parents('.other-player-table').find('.other-player-address');
        var offset  = $address.offset();
        var top     = offset['top'];
        var left    = offset['left'] - cha_width;
        var width   = $address.width();
        var height  = $address.height();    //xx
        var $color  = $('#shadow-other').find('#change-color');
        $color.css({'width':width,'height':width,'top':top,'left':left,'position':'absolute'});
    }
}

function useCookieSetting(){
    var last_uno_setting = getCookie('UNO_SETTING');
    if(last_uno_setting == null || last_uno_setting == undefined || last_uno_setting == 0){
        //设置框
        // setCookie('UNO_SETTING',[true,true,false,false,false]);
        // setCookie('UNO_SETTING_SPEED',30);
        showSetting();
    }else{
        last_uno_setting = last_uno_setting.split(',');
        for(var i=0;i<last_uno_setting.length;i++){
            if(last_uno_setting[i] == 'true'){
                important_setting_arr[i] = true;
                $('.setting-element').eq(i).addClass('setting-element-selected');
            }else{
                important_setting_arr[i] = false;
                $('.setting-element').eq(i).removeClass('setting-element-selected');
            }
        }
        var last_uno_setting_speed = getCookie('UNO_SETTING_SPEED');
        important_setting_speed = last_uno_setting_speed;
        $('#range_speed').css({"background-size": last_uno_setting_speed + '% 100%'}).val(last_uno_setting_speed);
        //console.log(last_uno_setting)
    }
}
function showSetting(){
    $('#setting').css({top:'100%',display:'block'}).stop().animate({top:'0%'},200,'swing');
}
function hideSetting() {
    $('#setting').stop().animate({top:'100%'},200,'swing',function(){
        $('#setting').hide();
    });
    var speed_value = $('#range_speed').val();
    var selectedArr = [false,false,false,false,false];
    $('.setting-element').each(function(){
        if($(this).hasClass('setting-element-selected')){
            selectedArr[$(this).index()-1] = true;
        }
    });
    important_setting_arr = selectedArr;
    important_setting_speed = speed_value;

    setCookie('UNO_SETTING_SPEED',speed_value);
    setCookie('UNO_SETTING',selectedArr);
}
$('.setting-element').click(function(){
    if($(this).hasClass('setting-element-selected')){
        $(this).removeClass('setting-element-selected');
    }else{
        $(this).addClass('setting-element-selected');
    }
});
function changeSpeed() {
    var value = $('#range_speed').val();
    var valStr = value + "% 100%";
    $('#range_speed').css({"background-size": valStr});
    //console.log(value)
}
//动画时长 500+250+1000+150=1800
function lzdAnimate(who,color,face){
    clearTimeout(important_computer_timer);
    var head_url = '';
    if(who != 0){
        head_url = $('#element'+who).parents('.other-player-address').find('.other-player-head').css('background-image').replace('head-MX','head-MXLH');
    }else{
        head_url = $('#mine-operate-head').css('background-image');
    }
    head_url = head_url.replace('url','').replace('(','').replace(')','').replace(/"/g,'');
    $('#header-animate-touxiang').find('img').attr('src',head_url);

    $('#header-animate').show();
    $('#header-animate-zhezhao').hide().css({'left':'0'});
    $('#header-animate-zhezhao').find('img').hide();
    var element = '<div class="one-card ' + color + '" data-face="0">0</div>';
    for(var i=0;i<face.length;i++){
        element += '<div class="one-card ' + color + '" data-face="' + face[i] + '">' + face[i] + '</div>';
    }
    $('#header-animate-handcard').html(element).hide();;

    if(important_player_music == true){
        var audio = document.getElementById('lzdmusic');
        audio.play();
    }
    $('#header-animate-touxiang').find('img').stop().css({'left':'100%'}).animate({'left':'0%'},500,function(){
        $('#header-animate-handcard').fadeIn(250);
        $('#header-animate-zhezhao').fadeIn(250,function(){
            $('#header-animate-zhezhao').find('img').eq(0).show();
            setTimeout(function(){
                $('#header-animate-zhezhao').find('img').eq(1).show();
            },100);
            setTimeout(function(){
                $('#header-animate-zhezhao').find('img').eq(2).show();
            },200);
            setTimeout(function(){
                $('#header-animate-touxiang').find('img').animate({'left':'-100%'},200);
                $('#header-animate-handcard').slideUp(150);
                $('#header-animate-zhezhao').animate({'left':'100%'},150,function(){
                    $('#header-animate').hide();
                });
                computerScript();
            },1000);
        });
    });
    //@TODO 失去了几张牌
}

function autoRobberyCard(){
    if(Math.random()<0.8){
        // console.log('失去抢牌');
        return false;
    }else 
    if(important_setting_arr[1] == true){
        // console.log('拥有抢牌');
        var card_color = important_card_color;
        var card_face  = important_card_face;
        var begin = 1;
        var parent_arr = [];
        var hand_color = '';
        var hand_face = '';
        var can_push_arr = [];
        if(important_player_rest == 1){
            begin = 0;
        }
        for (var i = begin; i < important_session_player_card.length; i++) {
            parent_arr = important_session_player_card[i];
            for (var j = 0; j < parent_arr.length; j++) {
                hand_color = parent_arr[j][0];
                hand_face  = parent_arr[j][1];
                if(hand_color == card_color && hand_face == card_face){
                    can_push_arr.push([hand_color,hand_face,i]);
                }else if(hand_face == card_face && hand_face == 'Wild'){
                    can_push_arr.push([hand_color,hand_face,i]);
                }else if(hand_face == card_face && hand_face == '+4'){
                    can_push_arr.push([hand_color,hand_face,i]);
                }
            }
        }
        if(can_push_arr.length != 0 && Math.random()<0.5){
            var put = randomArray(can_push_arr)[0];
            var color = put[0];
            var face = put[1];
            var boss = put[2];
            var this_card = null;
            if(face == 'Reverse'){
                //判断是不是本回合的人
                if(boss == important_player_round){
                    $('#reverse').show();
                    var num = randomArray([0,1])[0];
                    //0是本人抢牌 不然是本人普通出牌。
                    if(num == 0){
                        if(boss == 0){
                            $('#mine-handcard').removeClass().addClass('someone-want-qiangpai').addClass('full-left');
                            $('#mine-handcard').find('.one-card').each(function(){
                                if($(this).attr('data-color') == color && $(this).attr('data-face') == face){
                                    $(this).click();
                                    return false;
                                }
                            });
                        }else{
                            $('#element'+boss).parents('.other-player-address').removeClass().addClass('someone-want-qiangpai').addClass('other-player-address');
                        }
                        setTimeout(function(){
                            $('.someone-want-qiangpai').removeClass('someone-want-qiangpai');
                        },1800);
                    }
                    playerActionCard(color,face,boss,this_card);
                    setTimeout(function(){
                        $('#reverse-opinion').find('.reverse-opinion-element').eq(num).click();
                    },500);
                    
                }else{
                    //抢牌 
                    if(boss == 0){
                        $('#mine-handcard').removeClass().addClass('someone-want-qiangpai').addClass('full-left');
                        $('#mine-handcard').find('.one-card').each(function(){
                            if($(this).attr('data-color') == color && $(this).attr('data-face') == face){
                                $(this).click();
                                return false;
                            }
                        });
                    }else{
                        $('#element'+boss).parents('.other-player-address').removeClass().addClass('someone-want-qiangpai').addClass('other-player-address');
                        var isSuccess = playerActionCard(color,face,boss,this_card);
                        if(isSuccess == true){
                            markOrderJustNow();
                            markPlayerJustNow(boss);
                        }
                    }
                    setTimeout(function(){
                        $('.someone-want-qiangpai').removeClass('someone-want-qiangpai');
                    },1800);
                }
                
                return true;
            }else{
                if(canPushThisCard(color,face,boss) == true){
                    if(boss == 0){
                        $('#mine-handcard').removeClass().addClass('someone-want-qiangpai').addClass('full-left');
                        $('#mine-handcard').find('.one-card').each(function(){
                            if($(this).attr('data-color') == color && $(this).attr('data-face') == face){
                                $(this).click();
                                return false;
                            }
                        });
                    }else{
                        playerActionCard(color,face,boss,this_card);
                        if($('#element'+boss).html() == '氪达鸭'){
                            $('#element'+boss).parents('.other-player-address').removeClass().addClass('someone-want-qiangpais').addClass('other-player-address');
                        }else{
                            $('#element'+boss).parents('.other-player-address').removeClass().addClass('someone-want-qiangpai').addClass('other-player-address');
                        }
                        
                    }
                    setTimeout(function(){
                        $('.someone-want-qiangpai').removeClass('someone-want-qiangpai');
                        $('.someone-want-qiangpais').removeClass('someone-want-qiangpais');
                    },1800);

                    return true;
                }
            }
        }
    }
    return false;
}
//动画时长 300+1000+300+250=1850
function heshiAnimate(card_last,card_new){
    clearTimeout(important_computer_timer);

    setTimeout(function(){
        if(important_player_music == true){
            var audio = document.getElementById('sldmusic2');
            audio.play();
        }
    },250);
    $('#heshi-animate-card-last').html('<div class="one-card ' + card_last[0] + '" data-color="' + card_last[0] + '" data-face="' + card_last[1] + '">' + card_last[1] + '</div>');
    $('#heshi-animate-card-new').html('<div class="one-card ' + card_new[0] + '" data-color="' + card_new[0] + '" data-face="' + card_new[1] + '">' + card_new[1] + '</div>');
    $('#heshi-animate').fadeIn(300);
    $('#heshi-animate-card-new').animate({top:'2rem'},300,'linear');
    $('#heshi-animate-card-last').animate({top:'2rem'},300,'linear',function(){
        $('#heshi-animate-card').addClass('heshi-animate-card-rotating');
        // setTimeout(function(){
        //     if(important_player_music == true){
        //         var audio = document.getElementById('sldmusic');
        //         audio.play();
        //     }
        // },350);
        setTimeout(function(){
            //@TODO 黑洞吸收
            $('#heshi-animate-card-last').find('.one-card').addClass('blackholeLeft');
            $('#heshi-animate-card-new').find('.one-card').addClass('blackholeRight');
            setTimeout(function(){
                $('#heshi-animate-card-last').find('.one-card').removeClass('blackholeLeft').addClass('blackholeLeft-end');
                $('#heshi-animate-card-new').find('.one-card').removeClass('blackholeRight').addClass('blackholeRight-end');
                $('#heshi-animate').fadeOut(250,function(){
                    //图像归位
                    $('#heshi-animate-card').removeClass('heshi-animate-card-rotating');
                    $('#heshi-animate-card-last').css({'top':'-4rem'});
                    $('#heshi-animate-card-new').css({'top':'8rem'});
                });
            },300);
            computerScript();
        },1000);

    });
}
function autoHeshi(){
    if(important_setting_arr[4] == true && Math.random()<0.25){
        if(important_card_boss == 0 && important_player_rest == 0){
            return ;
        }
        var boss = important_card_boss;
        var color = important_card_color;
        var face = important_card_face;
        var now_hand = important_session_player_card[boss];
        var length = now_hand.length;
        var success = [];
        for (var i = 0; i <length; i++) {
            if(now_hand[i][0] == color){
                for(var n = 1; n < 10; n++){
                    if(face == String(n) && now_hand[i][1] == String(10 - n) ){
                        success.push([now_hand[i][0],now_hand[i][1]]);
                        break;
                    }
                }
            }
        }
        var card = randomArray(success)[0] || [];
        if(card.length!=0){
            var $card = null;
            if(boss == 0){
                var $this = null;
                $('#mine-handcard').find('.one-card').each(function(){
                    $this = $(this);
                    if($this.attr('data-color') == card[0] && $this.attr('data-face') == card[1]){
                        $card = $this;
                        return false;
                    }
                });
            }
            setTimeout(function(){
                important_player_heshi = true;
                playerActionCard(card[0],card[1],boss,$card);
            },100);
        }
    }
}