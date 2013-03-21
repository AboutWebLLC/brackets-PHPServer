<?php
    /**
     * Include a target PHP file, then use get_included_files() to find out what files it includes, 
     * return it as a JSON encoded array
     */
    
    //chdir incase the script calls getcwd() so it won't return the extension's path
    chdir($_SERVER['DOCUMENT_ROOT']);

    header('Content-type: application/json');
    
    //create an output buffer for the includes, which we will later erase
    ob_start();
        //include the target file
        include $_GET['target'];
    ob_end_clean();   

    //sometimes included PHP scripts create output buffers and we need to make sure they're erased
    while(ob_get_level() > 1){
        ob_end_clean();
    }

    //get all included files
    $files = get_included_files();
    //remove this from the list
    array_shift($files);    
    echo json_encode($files);
?>